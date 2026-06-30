# Tasks: Kiểm tra trạng thái khả dụng của camera — A5 (Check-availability RTSP)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-01 | Khởi tạo tasks.md cho IOT-005 (config-readiness) | Toàn bộ file (cũ) |
| 2026-06-30 | **A5 (TASKS)**: viết lại theo plan v2.0 — util probe mới(+test) → env var → service nhánh ip_camera(+test) → wiring route(+test) → seed permission(RECON role+duyệt) → cổng chất lượng. Truy vết AC-1…AC-18. Không đụng face_server/REC-005/IOT-014. | Toàn bộ file |

> Bám [spec.md](./spec.md) (v2.0) + [plan.md](./plan.md) (v2.0), cả hai đã khóa (§12 hết câu mở). **TASK-ONLY — chưa code.**
> **Build order**: util(+test) → env var → service ip_camera(+test) → wiring route(+test) → seed permission → cổng chất lượng.

---

## Danh sách Task

### T-01 — Util `rtsp-runtime-probe.util.ts` — *plan §3, spec §6.2/§8.2*
- **Mục tiêu**: hàm thuần spawn ffprobe trên RTSP URL + phân loại **7 nhóm** taxonomy §8.2, KHÔNG bao giờ ném.
- **File tạo mới**: `src/modules/iot/utils/rtsp-runtime-probe.util.ts`.
- **Việc cần làm** (mô tả, KHÔNG code):
  - Input `(url: string, timeoutMs: number)`; `url` đã dựng credential (service lo decrypt — util không chạm DB/secret).
  - Output object thuần: `{ group, reasonCode, isAvailable, runtimeVerified, healthStatus, statusAction }` với `statusAction ∈ {set_online,set_offline,keep}`.
  - spawn `process.env.FFPROBE_PATH||'ffprobe'`, args `-rtsp_transport tcp -v error -print_format json -show_streams <url>`; gom `stdout`+`stderr`; `setTimeout→kill`; cờ `settled`.
  - Phân loại **best-effort** (ưu tiên `exit code`, `stderr` phụ): Alive(exit0+video) / Auth-fail(401/403/Unauthorized) / Unreachable(refused/no route/name not known) / Not-a-stream(Invalid data/404/no video) / Timeout(kill) / Tool-unavailable(spawn `ENOENT`) / Default catch-all(`RTSP_PROBE_FAILED`).
  - **KHÔNG ném/không reject** ở mọi nhánh. Nếu tự log → `redactUrl(url)`; KHÔNG trả `stderr` thô ra ngoài.
- **Tái dùng (import, KHÔNG sửa)**: `redactUrl` từ `recording/utils/ffmpeg.util.ts`.
- **KHÔNG**: sửa `recording/utils/ffprobe.util.ts` (REC-005), không tái dùng `probeMedia` (nó nuốt lỗi), không đụng `probeTcp` IOT-014.
- **DoD**: util export hàm thuần, biên dịch sạch; mapping 7 nhóm khớp §8.2; không phụ thuộc Nest.
- **Phụ thuộc**: —.

### T-01b — Unit test util — *plan §9*
- **File tạo mới**: `src/modules/iot/utils/rtsp-runtime-probe.util.spec.ts`.
- **Việc cần làm**: **mock `child_process.spawn`** (KHÔNG cần camera thật). Mỗi nhóm ≥1 case, giả lập đúng tín hiệu:
  - exit 0 + JSON có video stream → **Alive** (`statusAction=set_online`).
  - `stderr` chứa `401 Unauthorized` → **Auth fail** (`RTSP_AUTH_FAILED`, keep).
  - `stderr` chứa `Connection refused`/`No route to host` → **Unreachable** (`RTSP_UNREACHABLE`, set_offline).
  - timer hết → process bị `kill` → **Timeout** (`RTSP_PROBE_TIMEOUT`, set_offline).
  - `stderr` chứa `Invalid data found`/không có video stream → **Not-a-stream** (`RTSP_INVALID_STREAM`, keep).
  - `spawn` emit `error` (ENOENT) → **Tool-unavailable** (`PROBE_TOOL_UNAVAILABLE`, keep, runtimeVerified=false).
  - exit code khác, stderr không khớp dấu hiệu nào → **Default** (`RTSP_PROBE_FAILED`, keep).
  - Bảo mật: assert util KHÔNG trả `stderr` thô; nếu spy logger thì URL đã redact.
- **DoD**: 7 nhóm xanh; coverage util ≥ ngưỡng dự án (≥80%).
- **Phụ thuộc**: T-01.

### T-02 — Env var `RTSP_RUNTIME_PROBE_TIMEOUT_MS` — *plan §5, spec §8.1*
- **Mục tiêu**: khai báo timeout riêng cho runtime RTSP probe (default 10000ms).
- **File sửa**: `src/config/env.validation.ts` (mục K2, cạnh IOT-014).
- **Việc cần làm**: thêm đúng 1 dòng Joi `RTSP_RUNTIME_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(10000)`. (Khuyến nghị: thêm dòng tương ứng vào `.env.example` nếu repo có — KHÔNG bắt buộc.)
- **KHÔNG**: đụng/đổi `RTSP_PROBE_TIMEOUT_MS` (giữ default 3000, IOT-014).
- **DoD**: schema validate pass; env mới đọc được qua `configService`.
- **Phụ thuộc**: —.

### T-03 — Service: nâng nhánh `ip_camera` của `checkAvailability` — *plan §4/§6, spec §6.2/§8*
- **Mục tiêu**: thay block config-readiness của `ip_camera` bằng config-gate→dựng URL→probe→map→persist.
- **File sửa**: `src/modules/iot/services/iot-devices.service.ts` (**chỉ nhánh `IP_CAMERA`** trong `checkAvailability`, ~L1170-1197).
- **Việc cần làm** (mô tả):
  - **Config-gate** (giữ pre-check v1.0): thiếu `room_id`→`DEVICE_ROOM_ASSIGNMENT_REQUIRED`; thiếu `rtsp_config`/`stream_url`→`RTSP_CONFIG_MISSING`; `rtsp_enabled=false`→`RTSP_DISABLED` (health=warning, runtime_verified=false, KHÔNG probe, KHÔNG online).
  - **Dựng URL có credential (in-memory)**: `streamUrl` + `rtsp_config.rtsp_username` + `decryptSecret(rtsp_config.rtsp_password_encrypted)` (nếu có) → `rtsp://user:pass@host:port/path`. Biến cục bộ, KHÔNG ghi DB/log (log qua `redactUrl`).
  - **Timeout**: `configService.get<number>('RTSP_RUNTIME_PROBE_TIMEOUT_MS', 10000)`.
  - **Probe**: gọi util T-01 → nhận object kết quả.
  - **Map taxonomy → entity** (§8.2): set `is_available`/`reason_code`/`health_status`; `status` theo `statusAction` (set_online Alive / set_offline Unreachable+Timeout / keep còn lại); `check_type='rtsp_runtime_probe'`; `message` = chuỗi **cố định theo `reason_code`** (hằng map, KHÔNG nhúng stderr).
  - **Persist** (tái dùng persist hiện có): merge `metadata_json.last_availability_check` (+`checked_by=userId`) + cập nhật `status`/`health_status`, transaction. KHÔNG audit.
- **KHÔNG**: đụng nhánh `FACE_SERVER`, `detectOfflineDevices`/`probeTcp` (IOT-014), thêm cột/enum/migration, async.
- **DoD**: nhánh ip_camera chạy probe thật + map đúng §8.2; chỉ set field/enum sẵn có; nhánh face_server KHÔNG đổi.
- **Phụ thuộc**: T-01, T-02.

### T-03b — Test service nhánh `ip_camera` (+ không hồi quy face_server) — *plan §9*
- **File sửa**: `src/modules/iot/services/iot-devices.service.spec.ts` (thêm test, GIỮ test cũ).
- **Việc cần làm**: **mock util T-01** + mock `decryptSecret`/`configService`/repo+queryRunner. Phủ:
  - Config-gate: thiếu room (AC-6), thiếu rtsp config (AC-7), rtsp disabled (AC-8) → không probe.
  - Alive → `is_available=true`, `status=online`, `check_type=rtsp_runtime_probe` (AC-9).
  - Unreachable/Timeout → `status=offline`, health=faulty; Auth-fail/Not-a-stream → giữ status, health=warning.
  - Persist merge: block metadata cũ (`rtsp_config`…) còn nguyên (AC-15); chỉ set field/enum sẵn có (AC-16).
  - **Không hồi quy face_server**: giữ test heartbeat (AC-3,4,5) + 404/409 (AC-1,2) — assert nhánh face_server không đổi hành vi.
  - Bảo mật (AC-14): assert URL/credential KHÔNG xuất hiện trong response/`message`/log (redact); `checked_by` không trả ra.
- **DoD**: test xanh; coverage nhánh service ip_camera ≥ ngưỡng; test face_server cũ vẫn xanh.
- **Phụ thuộc**: T-03.

### T-04 — Wiring route controller `POST :id/check-availability` — *plan §2.2/§7, spec §7*
- **Mục tiêu**: thêm route HTTP gọi `checkAvailability` (route đang thiếu) + guard auth THẬT.
- **File sửa**: `src/modules/iot/controllers/iot-devices.controller.ts` (thêm 1 route, GIỮ route cũ).
- **Việc cần làm**:
  - Route `@Post(':id/check-availability')` (route động — đặt sau các route tĩnh nếu có xung đột path).
  - **Guard auth THẬT**: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('iot_devices:check_availability')`, import từ `../../auth/guards/jwt-auth.guard.js`, `../../auth/guards/permissions.guard.js`, `../../auth/decorators/require-permissions.decorator.js` (mirror B21). **KHÔNG** dùng `MockPermissionsGuard`/`@Permissions` rỗng cục bộ.
  - `@Param('id', ParseUUIDPipe)` + `@CurrentUser` truyền `userId` vào service; envelope `{success,message,data}`; HTTP 200 (`@HttpCode`).
  - Response: device đã masked + object `availability` (KHÔNG `checked_by`, KHÔNG secret).
- **KHÔNG**: đụng các route iot cũ (giữ mock), KHÔNG migrate MockPermissionsGuard toàn module (nợ riêng).
- **DoD**: route đúng method/path/guard/permission; envelope + 200; gọi đúng `checkAvailability(userId, id)`.
- **Phụ thuộc**: T-03.

### T-04b — Test controller route — *plan §9*
- **File sửa/tạo**: test controller (mirror nơi đặt test iot controller hiện có; nếu chưa có thì `iot/controllers/iot-devices.controller.spec.ts`).
- **Việc cần làm**: mock service + **overrideGuard** `JwtAuthGuard`/`PermissionsGuard` (độc lập DB/seed); assert route gọi `checkAvailability` đúng `(userId, id)`; metadata `@RequirePermissions` = `iot_devices:check_availability` (đọc qua `Reflector`); envelope + HTTP 200.
- **DoD**: test xanh; phủ guard-metadata độc lập seed.
- **Phụ thuộc**: T-04.

### T-05 — Seed permission `iot_devices:check_availability` (RECON role → DUYỆT → seed) — *plan §7*
- **Mục tiêu**: tạo permission + gán role để guard không 403 mọi actor (điều kiện chạy thật).
- **File tạo mới**: `src/database/migrations/<timestamp>-SeedCheckAvailabilityPermission.ts` (đặt ở **migrations/** — tiền lệ avatar/B21 vì `seeds/` không có runner; timestamp lớn hơn migration mới nhất).
- **Việc cần làm**:
  1. **RECON role-set thật**: tìm trong `seeds/`+`migrations/` xem `iot_devices:assign_room` và `iot_devices:configure_rtsp` (hoặc permission `iot_devices:*` vận hành) **đang gán cho role_code nào** → đó là role-set vận hành IoT.
  2. **Mirror đúng role-set đó** cho `iot_devices:check_availability` (KHÔNG mở rộng/thu hẹp).
  3. **BÁO LẠI danh sách role để người duyệt TRƯỚC khi seed** — đánh dấu rõ "**danh sách role = đề xuất, chờ duyệt**", KHÔNG tự quyết (mô hình B21 tra `EMPLOYEE` từ seed thật).
  4. Migration `up`: INSERT permission `ON CONFLICT (permission_code) DO NOTHING` + fallback SELECT id; gán `role_permissions` qua `INSERT...SELECT r.id FROM roles WHERE role_code=$1 AND is_active=true ON CONFLICT (role_id,permission_id) DO NOTHING`. `down`: DELETE role_permissions theo permission_id + DELETE permission (mirror avatar).
  - **Idempotent** toàn bộ.
- **KHÔNG**: tự chốt role-set; chạy migration vào DB.
- **DoD**: migration biên dịch sạch, idempotent, `down` revert; danh sách role đã được người duyệt trước khi merge/chạy.
- **Phụ thuộc**: — (độc lập code; là điều kiện guard chạy thật).

### T-06 — Cổng chất lượng (KHÔNG commit) — *plan §10*
- **Mục tiêu**: xác nhận build/lint/test/coverage sạch + không hồi quy.
- **Việc cần làm** (chạy ở pha implement, KHÔNG ở task-phase):
  - `npx tsc -p tsconfig.build.json --noEmit` = 0.
  - eslint các file mới/đụng = 0 (prettier --fix nếu cần).
  - `npx jest src/modules/iot` xanh (mới + cũ KHÔNG hồi quy: face_server, IOT-014 probe).
  - **Coverage** (glob relative `rootDir=src`, KHÔNG prefix `src/`): `--collectCoverageFrom='modules/iot/utils/rtsp-runtime-probe.util.ts'` + nhánh service ip_camera ≥ ngưỡng (≥80%).
  - Khẳng định **KHÔNG hồi quy** `face_server`/REC-005 (`ffprobe.util.ts`)/`probeTcp` IOT-014/`RTSP_PROBE_TIMEOUT_MS`.
- **DoD**: tất cả pass; **STOP, KHÔNG commit**, chờ duyệt.
- **Phụ thuộc**: T-01…T-05.

---

## Bảng truy vết AC → Task
| AC (spec §11) | Nội dung | Task phủ |
|---|---|---|
| AC-1 | 404 thiết bị không tồn tại | T-03b (nhánh chung, không hồi quy) |
| AC-2 | 409 device_type không phải camera | T-03b |
| AC-3 | Face online (heartbeat ≤5') | T-03b (không hồi quy face_server) |
| AC-4 | Face offline (>5') | T-03b |
| AC-5 | Face chưa từng on | T-03b |
| AC-6 | IP thiếu room → DEVICE_ROOM_ASSIGNMENT_REQUIRED | T-03b (config-gate) |
| AC-7 | IP thiếu rtsp config → RTSP_CONFIG_MISSING | T-03b |
| AC-8 | IP rtsp disabled → RTSP_DISABLED | T-03b |
| AC-9 | Probe **Alive** → available, status online, check_type rtsp_runtime_probe | T-01b (util) + T-03b (service) |
| AC-10 | Probe **Unreachable** → RTSP_UNREACHABLE, faulty | T-01b + T-03b |
| AC-11 | Probe **Timeout** → RTSP_PROBE_TIMEOUT | T-01b + T-03b |
| AC-12 | Probe **Auth fail** → RTSP_AUTH_FAILED, warning | T-01b + T-03b |
| AC-13 | Probe **Not-a-stream** → RTSP_INVALID_STREAM, warning | T-01b + T-03b |
| AC-14 | Bảo mật: không lộ password/token/URL/credential trong log/message; `checked_by` không trả | T-01b + T-03b + T-04b |
| AC-15 | Merge metadata: block cũ còn nguyên | T-03b |
| AC-16 | Không enum/cột/migration schema mới | T-03b (assert field/enum sẵn có) |
| AC-17 | Thiếu ffprobe binary (ENOENT) → PROBE_TOOL_UNAVAILABLE, 200, health unknown | T-01b (util) + T-03b (service map) |
| AC-18 | Probe không khớp dấu hiệu → Default RTSP_PROBE_FAILED, faulty | T-01b + T-03b |

> Guard-metadata `iot_devices:check_availability` (RBAC tầng controller) phủ ở **T-04b** (độc lập DB/seed). Điều kiện guard không-403 khi chạy thật = **T-05** (seed permission, role chờ duyệt).

---

## Out-of-task (KHÔNG làm trong A5)
- KHÔNG đụng nhánh `face_server` (heartbeat v1.0).
- KHÔNG sửa `recording/utils/ffprobe.util.ts` (REC-005) / `recording/utils/ffmpeg.util.ts` (chỉ import `redactUrl`).
- KHÔNG sửa `probeTcp`/`detectOfflineDevices` (IOT-014) / KHÔNG đổi `RTSP_PROBE_TIMEOUT_MS`.
- KHÔNG thêm cột entity / enum / migration schema; KHÔNG async (probe đồng bộ trong request).
- KHÔNG migrate `MockPermissionsGuard` toàn module iot sang guard thật (nợ riêng, ngoài A5 — chỉ route mới dùng guard thật).
- KHÔNG nhận RTSP URL ad-hoc trong body (SSRF — loại bỏ mọi version).

## Open Questions — Cần người chốt
**Không còn câu hỏi mở.** Mọi quyết định đã chốt ở spec v2.0 (§12 hết câu mở) + plan v2.0 (OQ-P1 guard thật, OQ-P2 tra role ở tasks). Điểm cần **người duyệt khi chạy T-05**: danh sách role gán cho `iot_devices:check_availability` (RECON mirror role-set IoT thật rồi trình duyệt) — đây là bước duyệt-vận-hành trong T-05, KHÔNG phải câu hỏi mở chặn code.
