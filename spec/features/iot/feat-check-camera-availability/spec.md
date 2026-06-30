---
name: "Feature Specification: Kiểm tra trạng thái khả dụng của camera"
description: "Đặc tả kỹ thuật (Spec) cho IOT-005 / A5: Kiểm tra khả dụng camera. A5 nâng IP Room Camera từ config-readiness sang runtime RTSP probe thuần Nest (ffprobe), không bridge/IVSS SDK."
version: "2.0"
date: "2026-06-30"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-01 | Khởi tạo spec.md dựa trên clarification answers của USER | Toàn bộ file |
| 2026-06-30 | **A5 (Check-availability RTSP)**: nâng nhánh IP Room Camera từ "config readiness only" sang **runtime RTSP probe thuần Nest** qua ffprobe (mirror REC-005), thêm phân loại kết quả probe (alive/unreachable/auth-fail/timeout/not-a-stream), timeout & ràng buộc bảo mật credential. Face Server giữ nguyên heartbeat. Cập nhật §2/§6/§8/§9/§11 + thêm §12 Open Questions. | §1, §2, §3, §6, §7, §8, §9, §11, §12 |
| 2026-06-30 | **Revise chốt OQ**: chốt OQ-1 (đồng bộ), OQ-2 (chỉ cameraId, loại ad-hoc URL do SSRF), OQ-3 (message cố định theo reason_code), OQ-4 (alive→online; auth-fail/not-a-stream giữ status + health warning), OQ-5 (timeout 10000ms qua `RTSP_PROBE_TIMEOUT_MS`), OQ-6 (`PROBE_TOOL_UNAVAILABLE`), OQ-7 (không retry). Thêm nhóm `PROBE_TOOL_UNAVAILABLE` + nhóm mặc định `RTSP_PROBE_FAILED` + ghi chú phân loại best-effort (ưu tiên exit code). Thêm AC-17. §12 còn 1 OQ về giá trị/tên config timeout (default thật 3000ms, dùng chung IOT-014). | §3, §7, §8.1, §8.2, §8.4, §9, §11, §12 |
| 2026-06-30 | **Revise chốt OQ-A (phương án b)**: tách config riêng **`RTSP_RUNTIME_PROBE_TIMEOUT_MS`** (default 10000ms) cho runtime RTSP probe A5; giữ nguyên `RTSP_PROBE_TIMEOUT_MS`=3000ms cho batch IOT-014 (không hồi quy). Dọn tên enum thống nhất `face_server`/`ip_camera` (bỏ tên cũ song song ở §1/§6.1; giữ 1 ghi chú ở §3.1). §12 hết câu mở. | §1, §3.1, §6.1, §8.1, §12 |
| 2026-06-30 | **Đính chính §2 (PLAN recon)**: endpoint `POST :id/check-availability` thực ra **CHƯA wired** — logic `checkAvailability` mới chỉ ở tầng service, chưa có route controller. A5 phải thêm route mới (path giữ nguyên) đồng thời làm sâu nhánh ip_camera. | §2 |
| 2026-06-30 | **Đính chính naming permission**: đổi `iot_devices:check_availability` (colon) → **`iot.device.check_availability`** (dot) để ĐỒNG BỘ convention module iot (các permission đã seed: `iot.device.read/update/probe/disable/enable`). | §4, §7, §9 |

# 1. Mục tiêu (Overview)
A5 cho phép kiểm tra **một camera có thực sự khả dụng để phục vụ nghiệp vụ tiếp theo hay không** (gán camera vào phòng, trước khi ghi hình, chẩn đoán vận hành). Hệ thống phân định 2 tầng kiểm tra theo `device_type`:

1. **Runtime Availability (Face Server — `face_server`)**: dựa trên `last_seen_at` (heartbeat). **Giữ nguyên** so với v1.0.
2. **Runtime RTSP Probe (IP Room Camera — `ip_camera`)**: **A5 — phần làm sâu**. Trước đây v1.0 chỉ kiểm cấu hình đầy đủ (config readiness) và không probe thật. A5 để **NestJS tự probe luồng RTSP** bằng ffprobe và phân loại kết quả.

Endpoint là **diagnostic action** có side-effect lưu kết quả chẩn đoán vào DB (merge vào `metadata_json.last_availability_check`).

# 2. Bối cảnh & hiện trạng "nông"
- **Logic `IoTDevicesService.checkAvailability` đã tồn tại ở tầng service, NHƯNG CHƯA được wiring route controller** (RECON: không có route nào gọi nó → endpoint HTTP `POST /api/v1/iot-devices/:id/check-availability` **chưa tồn tại thật**). → A5 phải **thêm route mới** này (path giữ nguyên §7), đồng thời làm sâu nhánh `ip_camera`.
- Nhánh IP Camera hiện **chỉ kiểm config readiness**: đủ `rtsp_config` → trả `is_available=true`, `runtime_verified=false`, message *"RTSP configuration is ready. Runtime stream probing is not performed in this version."* → **không chứng minh được stream sống**.
- `probeTcp` (`iot/utils/rtsp-probe.util.ts`, IOT-014) chỉ mở TCP host:port — **không đọc RTSP payload**, không phân biệt được sai credential hay URL không phải luồng video.
- Năng lực sẵn có: **ffprobe** đã là dependency chính thức (`recording/utils/ffprobe.util.ts` — REC-005, `FFPROBE_PATH` env default `ffprobe`, timeout 10s, spawn child_process). `decryptSecret` có sẵn để dựng URL có auth. `redactUrl()` có sẵn để che credential khi log.

A5 lấp khoảng trống: thay phần "config readiness only" của IP Camera bằng **config-gate → probe RTSP thật (ffprobe) → phân loại kết quả**.

# 3. Phạm vi (Scope)

## 3.1. In-scope
- **Thiết bị áp dụng**: `iot_devices` có `device_type` ∈ {`face_server`, `ip_camera`} (tên enum thật trong code; tài liệu cũ gọi `door_face_terminal`/`ip_room_camera`).
- **A5 runtime probe** cho IP Camera: NestJS spawn **ffprobe** trên RTSP URL của thiết bị (dựng từ `stream_url` + credential giải mã), với timeout, rồi **phân loại** kết quả (§6.2, §8).
- **Cập nhật DB** (merge, không ghi đè): `metadata_json.last_availability_check`, và `status`/`health_status`/`updated_at` theo bảng mapping §8.
- **Bảo mật**: không expose `rtsp_password`/`rtsp_password_encrypted`/`callback_token`/`callback_token_hash` ra response; **không bao giờ log RTSP URL có credential** (qua `redactUrl`).

## 3.2. Out of scope
- **Probe RTSP URL ad-hoc trong body = LOẠI BỎ ở mọi version** (không phải 'future') do rủi ro **SSRF**: backend không nhận URL tùy ý từ client để probe. Chỉ probe URL dựng từ cấu hình đã lưu của thiết bị (cameraId). Body = none (MVP).
- KHÔNG gọi bridge, KHÔNG dùng IVSS/Dahua SDK (IVSS chỉ phục vụ presence — ngoài A5).
- KHÔNG đọc RTSP trực tiếp trong request handler bằng cách tự parse giao thức (chỉ spawn ffprobe ngoài tiến trình).
- KHÔNG có Python Camera Service tham gia (thuần Nest).
- KHÔNG xử lý điểm danh / tracking người / nhận diện khuôn mặt / no-show / live-meeting / start-stop ghi hình.
- KHÔNG thêm cột entity / migration mới (tái dùng `metadata_json` + `status` + `health_status`).

# 4. Actors & RBAC
- **Actor**: Admin/vận hành (qua Frontend/Admin Panel) gọi diagnostic.
- **AuthN**: `Authorization: Bearer <token>` (JwtAuthGuard).
- **AuthZ**: permission `iot.device.check_availability` (PermissionsGuard + `@RequirePermissions`). KHÔNG hard-code theo role name.
- **Security note (security.md)**: RTSP URL chứa credential nhạy cảm → chỉ actor có quyền chẩn đoán mới được gọi; response/log tuyệt đối không lộ credential (§8.4).

# 5. Tiền điều kiện (Preconditions)
- Thiết bị tồn tại trong `iot_devices` và `device_type` hợp lệ (face_server | ip_camera).
- Với IP Camera để probe được: đã có `room_id`, có `rtsp_config` + `stream_url`, và `rtsp_enabled = true` (nếu thiếu → config-gate trả lỗi tương ứng, KHÔNG probe — §6.2 bước 0).
- Môi trường có sẵn binary ffprobe (`FFPROBE_PATH`).

# 6. Luồng nghiệp vụ (Business flow)

## 6.1. Face Server (`face_server`) — heartbeat (GIỮ NGUYÊN v1.0)
Dựa trên `last_seen_at`, ngưỡng **5 phút**. `check_type = heartbeat_status`, `runtime_verified = true` (trừ chưa từng thấy).

| Tình trạng `last_seen_at` | `is_available` | `status` | `health_status` | `reason_code` |
| :--- | :--- | :--- | :--- | :--- |
| ≤ 5 phút | `true` | `online` | `healthy` | `null` |
| > 5 phút | `false` | `offline` | `faulty` | `HEARTBEAT_STALE` |
| `null` (chưa từng thấy) | `false` | `offline` | `unknown` | `HEARTBEAT_NOT_SEEN` |

## 6.2. IP Room Camera (`ip_camera`) — A5 runtime RTSP probe (PHẦN LÀM SÂU)
`check_type = rtsp_runtime_probe`. Các bước:

**Bước 0 — Config-gate (short-circuit, KHÔNG probe nếu fail)** — tái dùng pre-check v1.0:
- Thiếu `room_id` → `is_available=false`, `reason_code=DEVICE_ROOM_ASSIGNMENT_REQUIRED`, `health_status=warning`.
- Thiếu `rtsp_config`/`stream_url` → `RTSP_CONFIG_MISSING`, `health_status=warning`.
- `rtsp_enabled = false` → `RTSP_DISABLED`, `health_status=warning`.
- (3 case trên `runtime_verified=false`, KHÔNG đổi `status` thành online.)

**Bước 1 — Dựng RTSP URL có credential**: từ `stream_url` (`rtsp://host:port/path`) + `rtsp_username` + `decryptSecret(rtsp_password_encrypted)` nếu có → URL đầy đủ `rtsp://user:pass@host:port/path`. URL này **chỉ tồn tại trong bộ nhớ tiến trình**, KHÔNG ghi DB, KHÔNG log (mọi log phải qua `redactUrl`).

**Bước 2 — Spawn ffprobe** (mirror REC-005, `-rtsp_transport tcp` cho ổn định) trên URL, với **timeout** (§8.1). Thu `exit code` + `stderr` để phân loại.

**Bước 3 — Phân loại kết quả** theo taxonomy §8.2 (ưu tiên exit code, stderr phụ; có nhóm mặc định an toàn) → set `is_available`/`status`/`health_status`/`reason_code`/`message` (`runtime_verified=true` khi đã thực probe; riêng `PROBE_TOOL_UNAVAILABLE` = `false`).

**Bước 4 — Persist**: merge kết quả vào `metadata_json.last_availability_check` + cập nhật `status`/`health_status` (transaction). KHÔNG audit (§10).

# 7. API surface (mô tả nghiệp vụ — KHÔNG code)
| Method + Path | Role / Permission | Input | Output | Mã thành công |
| :--- | :--- | :--- | :--- | :--- |
| `POST /api/v1/iot-devices/{id}/check-availability` | `iot.device.check_availability` | Path `id` (UUID); **Body: none** (MVP) | Device đã masked + object `availability` (§8.3) | 200 |

- `id` validate UUID (`ParseUUIDPipe`).
- Probe chạy **ĐỒNG BỘ** trong request: client chờ tới khi probe xong hoặc hết timeout. **KHÔNG** dùng background job/async/job-id-poll.
- `availability` object: `is_available`, `check_type`, `runtime_verified`, `reason_code`, `message`, `checked_at`. **KHÔNG** trả `checked_by` (chỉ lưu DB).

# 8. Quy tắc & ràng buộc

## 8.1. Timeout & retry
- **Timeout probe = 10000ms**, lấy từ **config env RIÊNG mới `RTSP_RUNTIME_PROBE_TIMEOUT_MS`** (default 10000ms), dành riêng cho runtime RTSP probe của A5. Hết timeout → kill tiến trình ffprobe → phân loại `RTSP_PROBE_TIMEOUT`.
  - **Lý do tách config** (chốt OQ-A, phương án b): A5 là **single-probe chẩn đoán** — chờ tới ~10s cho 1 camera là chấp nhận được để xác thực stream sống. Trong khi `RTSP_PROBE_TIMEOUT_MS`=**3000ms** đang dùng cho **batch TCP probe IOT-014** (detect-offline, cần nhanh vì quét nhiều camera). Hai ngữ cảnh khác nhau → tách config; **KHÔNG đụng `RTSP_PROBE_TIMEOUT_MS`** (giữ 3000ms), **không hồi quy IOT-014**.
  - **Phạm vi**: việc **khai báo env var mới `RTSP_RUNTIME_PROBE_TIMEOUT_MS`** trong `src/config/env.validation.ts` là việc của **PLAN/TASKS** (đụng config env, KHÔNG phải migration DB, KHÔNG phải cột entity). Spec chỉ nêu **tên + default (10000ms)**.
- **Retry**: v1 **KHÔNG retry** — đúng 1 lần probe cho mỗi lần gọi endpoint.
- Probe phải **không bao giờ ném** (mọi lỗi → một nhóm phân loại §8.2) để 1 camera lỗi không làm sập request.

## 8.2. Phân loại kết quả probe (taxonomy — cốt lõi A5)

| Nhóm | Dấu hiệu (ffprobe) | `is_available` | `runtime_verified` | `reason_code` | `status` | `health_status` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Alive** | exit 0 + có video stream | `true` | `true` | `null` | `online` | `healthy` |
| **Unreachable** | connection refused / no route / DNS fail | `false` | `true` | `RTSP_UNREACHABLE` | `offline` | `faulty` |
| **Timeout** | vượt timeout (ffprobe bị kill) | `false` | `true` | `RTSP_PROBE_TIMEOUT` | `offline` | `faulty` |
| **Auth fail** | 401/403/Unauthorized trong stderr | `false` | `true` | `RTSP_AUTH_FAILED` | **giữ nguyên** | `warning` |
| **Not a stream** | Invalid data / 404 / không có video stream | `false` | `true` | `RTSP_INVALID_STREAM` | **giữ nguyên** | `warning` |
| **Tool unavailable** | spawn `ENOENT` (không có binary ffprobe) | `false` | `false` | `PROBE_TOOL_UNAVAILABLE` | **giữ nguyên** | `unknown` |
| **Default (catch-all)** | không khớp dấu hiệu nào ở trên | `false` | `true` | `RTSP_PROBE_FAILED` | **giữ nguyên** | `faulty` |

> **Phân loại là BEST-EFFORT (chống brittle)**: ưu tiên **`exit code`** của ffprobe để quyết nhánh; chuỗi `stderr` chỉ dùng **phụ** để phân biệt unreachable/auth/not-a-stream và **KHÔNG phải hợp đồng ổn định** — đổi version ffprobe có thể đổi text. Mọi kết quả **không khớp dấu hiệu nào** → rơi vào **nhóm Default `RTSP_PROBE_FAILED`** (an toàn, KHÔNG đoán bừa), KHÔNG tự suy thành alive. `PROBE_TOOL_UNAVAILABLE` là lỗi hạ tầng (thiếu binary), tách riêng để vận hành xử lý.
>
> Lưu ý enum: chỉ dùng `health_status` ∈ {`healthy`,`warning`,`faulty`,`unknown`} và `status` ∈ {`online`,`offline`,`disabled`,`maintenance`} sẵn có — **KHÔNG thêm enum mới**. `reason_code` là chuỗi tự do trong `metadata_json` (không phải cột enum). "giữ nguyên" = không đổi `status` hiện tại của thiết bị.

## 8.3. Cấu trúc lưu `metadata_json.last_availability_check` (merge, không ghi đè)
```json
{
  "last_availability_check": {
    "is_available": false,
    "check_type": "rtsp_runtime_probe",
    "runtime_verified": true,
    "reason_code": "RTSP_AUTH_FAILED",
    "message": "...",
    "checked_at": "2026-06-30T10:00:00.000Z",
    "checked_by": "user_id"
  }
}
```
Phải **merge** (giữ nguyên `rtsp_config`, `face_server_config`, `vendor`, `connection`…), tuyệt đối không xóa metadata cũ.

## 8.4. Bảo mật (security.md + data-governance.md)
- Response **không** chứa `rtsp_password`, `rtsp_password_encrypted`, `callback_token`, `callback_token_hash`, hay bất kỳ secret nào trong `metadata_json` (mask/filter trước khi trả).
- **RTSP URL có credential KHÔNG được log/trả ra/lưu DB** ở bất kỳ đâu; mọi chuỗi có thể chứa `rtsp://user:pass@` phải qua `redactUrl` trước khi log.
- **`message` trả client là chuỗi CỐ ĐỊNH theo `reason_code`** (mỗi nhóm phân loại có 1 câu mô tả định sẵn), **TUYỆT ĐỐI KHÔNG nhúng `stderr` thô** của ffprobe vào `message` hay vào DB — vì stderr có thể chứa RTSP URL kèm credential. Nếu cần log stderr để chẩn đoán vận hành thì phải `redactUrl` trước.
- `checked_by` chỉ lưu DB, không trả response.

# 9. Lỗi & Edge case
| Mã | Tình huống | HTTP / code |
| :--- | :--- | :--- |
| ERR-1 | Chưa đăng nhập | 401 |
| ERR-2 | Thiếu quyền `iot.device.check_availability` | 403 |
| ERR-3 | `id` không phải UUID | 400 |
| ERR-4 | Thiết bị không tồn tại | 404 `IOT_DEVICE_NOT_FOUND` |
| ERR-5 | `device_type` không phải camera | 409 `DEVICE_TYPE_NOT_CAMERA` |
| — | Config-gate fail (room/rtsp/disabled) | 200 + `is_available=false` + reason (không phải lỗi HTTP) |
| — | Probe các nhóm unreachable/timeout/auth/not-a-stream | 200 + `is_available=false` + reason (chẩn đoán, không phải 5xx) |
| EDGE | ffprobe binary thiếu (spawn ENOENT) | **200** + `is_available=false` + `reason_code=PROBE_TOOL_UNAVAILABLE` + `health=unknown` (KHÔNG 500, không lộ chi tiết hạ tầng; log cảnh báo vận hành qua redact) |

Edge: probe là chẩn đoán → kết quả "không khả dụng" **không phải lỗi HTTP**, vẫn trả 200 kèm `availability` phân loại.

# 10. Audit
Theo v1.0: **KHÔNG ghi audit_logs** cho check-availability (tính chất chẩn đoán gọi nhiều lần). Giữ nguyên ở A5. (Nếu vận hành muốn audit khi probe đổi `status` → OQ.)

# 11. Acceptance Criteria (kiểm chứng được)
1. **Thiết bị không tồn tại** → 404 `IOT_DEVICE_NOT_FOUND`.
2. **Loại thiết bị không phải camera** → 409 `DEVICE_TYPE_NOT_CAMERA`.
3. **Face online** (heartbeat ≤5') → available, `status=online`, `health=healthy`.
4. **Face offline** (heartbeat >5') → unavailable, `status=offline`, `health=faulty`, reason `HEARTBEAT_STALE`.
5. **Face chưa từng on** → unavailable, reason `HEARTBEAT_NOT_SEEN`.
6. **IP Camera thiếu room** → `DEVICE_ROOM_ASSIGNMENT_REQUIRED`, không probe.
7. **IP Camera thiếu rtsp config** → `RTSP_CONFIG_MISSING`, không probe.
8. **IP Camera rtsp disabled** → `RTSP_DISABLED`, không probe.
9. **A5 — Probe alive**: config đủ + ffprobe exit 0 có video → `is_available=true`, `runtime_verified=true`, `check_type=rtsp_runtime_probe`, `health=healthy`.
10. **A5 — Probe unreachable** → `is_available=false`, reason `RTSP_UNREACHABLE`, `health=faulty`.
11. **A5 — Probe timeout** → `is_available=false`, reason `RTSP_PROBE_TIMEOUT` (ffprobe bị kill sau timeout).
12. **A5 — Probe auth fail** → `is_available=false`, reason `RTSP_AUTH_FAILED`, `health=warning`.
13. **A5 — Probe not-a-stream** → `is_available=false`, reason `RTSP_INVALID_STREAM`, `health=warning`.
14. **Bảo mật**: response không lộ password/encrypted/token; **không có RTSP URL/credential trong log hay message** (đã redact); `checked_by` không trả ra.
15. **Merge metadata**: sau call, các block metadata cũ (`rtsp_config`…) còn nguyên, chỉ `last_availability_check` được cập nhật.
16. **Không enum/cột mới**: chỉ dùng `status`/`health_status` enum sẵn có + `metadata_json`; không migration.
17. **A5 — Thiếu ffprobe binary**: Given môi trường không có ffprobe (spawn ENOENT); When gọi check-availability cho IP camera config đủ; Then trả **200**, `is_available=false`, `reason_code=PROBE_TOOL_UNAVAILABLE`, `health_status=unknown`, `runtime_verified=false`, **KHÔNG 500**, **KHÔNG lộ chi tiết hạ tầng** trong response.
18. **A5 — Probe không khớp dấu hiệu (default)**: Given ffprobe trả kết quả/exit không khớp nhóm nào; When phân loại; Then rơi vào nhóm mặc định `RTSP_PROBE_FAILED`, `is_available=false`, `health=faulty`, **KHÔNG** tự suy thành alive.

# 12. Open Questions — Cần người chốt
**Không còn câu hỏi mở.** OQ-1…OQ-7 và OQ-A đều đã chốt và nội suy vào §3/§7/§8 (xem CHANGELOG các dòng 2026-06-30). OQ-A chốt theo **phương án (b)**: tách config riêng `RTSP_RUNTIME_PROBE_TIMEOUT_MS` (default 10000ms) cho A5, giữ `RTSP_PROBE_TIMEOUT_MS`=3000ms cho IOT-014 (§8.1).
