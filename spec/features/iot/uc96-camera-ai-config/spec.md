# IAC-001 — UC-96 (IoT): Cấu hình chức năng AI của camera

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec IAC-001 (UC-96, FT-18 SCMPTS): bật/tắt nhận diện mặt / biển số / đếm người của camera, lưu `iot_devices.metadata_json.ai_config`. Chỉ ghi DB — BE không đẩy config xuống thiết bị (RECON: 0 lời gọi HTTP trong service). 6 quyết định đã chốt (§7). ⚠⚠ Config là **TUYÊN BỐ Ý ĐỊNH** của quản trị viên, có thể lệch cấu hình thật trên IVSS — **TUYỆT ĐỐI KHÔNG** dùng để lọc/chặn event (§1/§9, QĐ-2). | Toàn bộ |
| 2026-07-23 | Thiếu Chủ chốt OQ-1→OQ-10 (§8 → ĐÃ CHỐT). Merge từng cờ (không replace), 5 loại device allowlist, audit `logConfigureAi`, response cả device, `SYSTEM_ADMIN` only, 3 cờ boolean. **3 điểm bổ sung/khác đề xuất agent**: (i) OQ-1 JSDoc map mỗi cờ → **LOẠI EVENT** (`face_recognition→ivss_face_event`, `plate_recognition→sự kiện biển số`, `people_counting→occupancy`) cho consumer phát-hiện-lệch, không dùng nhãn IVSS; (ii) OQ-2 allowlist **5 loại** (= allowlist UC-94: IP_CAMERA/DOOR_CAMERA/ROOM_CAMERA/OCCUPANCY_SENSOR/FACE_SERVER) thay vì 3; (iii) OQ-3 thêm **nguyên tắc túi-tự-do→replace / hình-dạng-cố-định→merge** + luật **`absent` ≠ `false`**. Cập nhật §2/§3/§4/§5. | §2, §3, §4, §5, §8 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Module **`iot`** (khác 8 UC gần đây ở `zones`/`anpr`). RECON đối chiếu độc lập trên code thật (§0). 6 quyết định đã chốt ở §7 — **KHÔNG mở lại**, đặc biệt QĐ-2. Mirror khuôn `configureRtsp` (metadata_json + transaction + audit + trả cả device).
> ⚠⚠ **ĐIỂM SỐNG CÒN (QĐ-2)**: BE **không có kênh** đẩy config xuống camera/IVSS ⇒ giá trị trong DB chỉ là **ý định**, có thể **lệch** với cấu hình đang chạy thật. **CẤM** dùng `ai_config` để lọc/bỏ event từ thiết bị. Camera khai "tắt nhận diện mặt" mà vẫn gửi face event ⇒ **vẫn xử lý bình thường** (rất có thể DB mới là cái sai). Xem §1 + §9.

---

## 0. RECON findings (đã đọc CODE THẬT — đã xác minh)

### 0.1. BE không đẩy config xuống thiết bị (nền của QĐ-1/QĐ-2)
- `iot-devices.service.ts` có **0 lời gọi HTTP** (grep `HttpService`/`axios`/`fetch(` = 0). ⇒ mọi `configure*` chỉ **ghi `metadata_json`**, KHÔNG có kênh đẩy xuống camera/IVSS.

### 0.2. `configureRtsp` — khuôn để mirror ([iot-devices.service.ts:1119-1235](../../../../src/modules/iot/services/iot-devices.service.ts))
- Controller [iot-devices.controller.ts:181-205](../../../../src/modules/iot/controllers/iot-devices.controller.ts): `@Patch(':id/rtsp-config')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('iot_devices:configure_rtsp')` · `ValidationPipe({ whitelist:true, forbidNonWhitelisted:false, transform:true })` (route-level) · `@Param('id', ParseUUIDPipe)` · `@Body() ConfigureRtspDto` → `toIotDeviceResponse(device)`.
- Service: load device ([:1124](../../../../src/modules/iot/services/iot-devices.service.ts)); 404 `IOT_DEVICE_NOT_FOUND`; **allowlist device_type** `IP_CAMERA` || `ROOM_CAMERA`, khác → 409 `DEVICE_TYPE_NOT_RTSP_CAMERA` ([:1135-1143](../../../../src/modules/iot/services/iot-devices.service.ts)); yêu cầu `roomId`, thiếu → 409 `DEVICE_ROOM_ASSIGNMENT_REQUIRED` ([:1145-1150](../../../../src/modules/iot/services/iot-devices.service.ts)).
- **Merge**: `updatedMetadata = { ...currentMetadata, rtsp_config: newRtspConfig }` ([:1202-1205](../../../../src/modules/iot/services/iot-devices.service.ts)) — giữ mọi khoá khác của `metadata_json`, **replace TOÀN BỘ cụm `rtsp_config`** (gửi thiếu field con thì field con cũ mất, trừ password carry-over tường minh). `configured_at: new Date().toISOString()` trong JSON ([:1196](../../../../src/modules/iot/services/iot-devices.service.ts)).
- **Transaction** `queryRunner` + **audit** `this.iotAuditRepository.logConfigureRtsp(qr.manager, {...})` ([:1209-1234](../../../../src/modules/iot/services/iot-devices.service.ts)); trả `savedDevice` (cả `metadata_json`).
- **Mask**: password RTSP lưu `rtsp_password_encrypted` (AES-256-GCM, KHÔNG plaintext) ([:1198-1200](../../../../src/modules/iot/services/iot-devices.service.ts)); response trả cả `metadata_json` gồm bản mã hoá đó (che bằng mã hoá, không phải xoá khỏi response).

### 0.3. `configureFaceServer` ≠ UC-96 (kết luận OQ-6) ([iot-devices.service.ts:820-917](../../../../src/modules/iot/services/iot-devices.service.ts))
- Hàm này cấu hình **kết nối callback HTTP của Door Face Terminal**: `callback_enabled`, `callback_protocol/base_url`, `heartbeat_path`/`verify_path`/`stranger_path`, `allowed_source_ip`, sinh `callback_token_hash`/`callback_token_last4` ([:865-876](../../../../src/modules/iot/services/iot-devices.service.ts)); ghi `metadata_json.face_server_config`; trả kèm `oneTimeCallbackToken` (plaintext 1 lần).
- ⇒ Đây là **cấu hình đường callback / token bảo mật**, KHÔNG phải bật/tắt chức năng AI (mặt/biển/đếm người). **UC-96 là chức năng KHÁC HẲN** — không phải route còn thiếu của `configureFaceServer`. `configureFaceServer` vẫn là code chết (0 caller), có spec riêng `feat-configure-face-server-connection`. UC-96 **KHÔNG đụng** nó (QĐ-6). Xem OQ-6.

### 0.4. `IoTDeviceEntity` ([iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts))
- `metadataJson` map cột `metadata_json` **jsonb** nullable ([:116-117](../../../../src/modules/iot/entities/iot-device.entity.ts)) — nơi lưu `ai_config`.
- `IoTDeviceType` **8 giá trị** ([:13-22](../../../../src/modules/iot/entities/iot-device.entity.ts)): `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `FACE_SERVER`, `MICROPHONE`, `CAPTURE_AGENT`, `OCCUPANCY_SENSOR`, `DISPLAY`.
- Khoá `metadata_json` đang dùng: `rtsp_config` (RTSP), `face_server_config` (callback face), `last_availability_check` (probe). ⇒ UC-96 thêm khoá mới **`ai_config`**, không đụng 3 khoá kia.

### 0.5. `IotAuditRepository` — audit là chuẩn cho config ops ([iot-audit.repository.ts](../../../../src/modules/iot/repositories/iot-audit.repository.ts))
- Đã có: `logDeviceCreation`, `logAssignRoom`, `logDeviceUpdate`, `logDeviceStatusChange`, `logConfigureFaceServer`, `logRevokeFaceServerToken`, `logRotateFaceServerToken`, `logConfigureRtsp`. ⇒ Mọi thao tác cấu hình thiết bị **đều ghi audit**; UC-96 nên có `logConfigureAi` (OQ-5 — có tiền lệ mạnh).

### 0.6. Permission `iot.*` — 2 quy ước song song (nền QĐ-4)
- **Dấu hai chấm (di sản, họ config/create)** ([20260720000005:286-309](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)): `iot_devices:assign_room`, `iot_devices:configure_face_server`, `iot_devices:configure_rtsp`, `iot_devices:create` — **tất cả `SYSTEM_ADMIN` only**.
- **Dấu chấm 3 tầng (mới)** ([:310-345](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)): `iot.device.check_availability/disable/enable/probe/read/update` — **`MANAGER` + `SYSTEM_ADMIN`**.
- ⇒ `configure_rtsp` (anh em gần nhất của UC-96) = **`SYSTEM_ADMIN` only**, dạng hai chấm. UC-96 chốt dùng **dấu chấm** (QĐ-4) `iot.device.configure_ai`; role xem OQ-8.

### 0.7. Mẫu seed permission ([20260722000007-SeedGateLogReadPermission.ts](../../../../src/database/migrations/20260722000007-SeedGateLogReadPermission.ts))
- INSERT 6 cột `(permission_code, permission_name, module_code, action_code, description, is_active)`, `action_code` tường minh, `ON CONFLICT DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước.

### 0.8. Controller & mốc
- [iot-devices.controller.ts](../../../../src/modules/iot/controllers/iot-devices.controller.ts): `@Controller('iot-devices')`; route `:id/...` đã có: `@Patch(':id')`, `@Patch(':id/rtsp-config')`, `@Post(':id/assign-room')`, `@Post(':id/face-server/revoke|rotate')`, `@Post(':id/disable|enable|check-availability)`. UC-96 thêm `@Patch(':id/ai-config')` — 2 segment, không xung đột `:id`.
- Chưa có DTO/mapper/route nào cho AI config (kỳ vọng đúng).
- Migration cuối `20260722000008-AddGateLogsPairedUniqueIndex.ts` ⇒ UC-96 lấy **`20260722000009`** (T0 đếm lại). Baseline `iot` **11 suite / 172 test**.

---

## 1. Scope (UC-96)

### TRONG scope
1. **Route** `PATCH /api/v1/iot-devices/:id/ai-config` — bật/tắt chức năng AI của camera, ghi `metadata_json.ai_config`.
2. **Method** thêm vào `IotDevicesService` (vd `configureAiConfig`) — mirror `configureRtsp`: load device, allowlist device_type (OQ-2), merge `ai_config` vào `metadata_json`, transaction + audit, trả device.
3. **DTO** `ConfigureAiConfigDto` — các cờ boolean (OQ-1/OQ-9).
4. **1 migration seed permission** `iot.device.configure_ai`.
5. Unit test (mock repo, không DB).

### NGOÀI scope
- **⚠⚠ KHÔNG dùng `ai_config` để lọc/chặn/bỏ event** từ camera/IVSS (QĐ-2). Config là **ý định**, không phải trạng thái thật; BE không đẩy được xuống thiết bị nên DB **có thể lệch**. Consumer lọc event theo config = **mất dữ liệu thật**.
- **KHÔNG** đẩy config xuống thiết bị (BE không có kênh HTTP — QĐ-1). Không thiết kế bridge push.
- **KHÔNG** migration schema (không cột/bảng/index — QĐ-5).
- **KHÔNG** đụng `configureRtsp`/`configureFaceServer`/`countByZoneId`/`setZoneForDevices`/`findAssignableByIds` hay method khác của `IotDevicesService` (QĐ-6).
- **KHÔNG** đụng module `zones`/`anpr`/`scheduler`.
- **KHÔNG** "sửa" code chết `configureFaceServer` (khác chức năng — §0.3).
- **KHÔNG** phát hiện lệch cấu hình (config drift) — đó là consumer làm cùng UC-105, ghi nợ §9.

## 2. Cấu trúc `ai_config` (ĐÃ CHỐT OQ-1)

Khoá mới trong `metadata_json`, mirror `rtsp_config`:
```json
{
  "ai_config": {
    "face_recognition": true,
    "plate_recognition": false,
    "people_counting": true,
    "configured_at": "2026-07-23T...Z"
  }
}
```
- **3 cờ boolean** cho 3 chức năng AI + `configured_at` (mirror `rtsp_config.configured_at`). Tên **nghiệp vụ hệ thống**, KHÔNG dùng nhãn IVSS. Actor **KHÔNG** trong JSON (ở `audit_logs`, mirror `rtsp_config`).
- ⚠ **Map cờ → LOẠI EVENT** (bắt buộc ghi JSDoc — phục vụ consumer phát-hiện-lệch UC-105, KHÔNG phải nhãn UI IVSS):
  - `face_recognition` → `ivss_face_event`
  - `plate_recognition` → sự kiện biển số (vehicle plate event)
  - `people_counting` → sự kiện occupancy
- ⚠ **`absent` ≠ `false`**: khoá vắng mặt = admin **chưa khai**; `false` = admin **khai phải tắt**. Lần PATCH đầu chỉ gửi 1 cờ ⇒ 2 cờ kia **vẫn vắng mặt**, KHÔNG mặc định `false`. Consumer chỉ cảnh báo lệch khi cờ **`false` tường minh**.

## 3. DTO (đề xuất)

`ConfigureAiConfigDto` — mỗi cờ `@IsOptional() @IsBoolean()` (partial update — OQ-3):

| Field API | Property | Ràng buộc |
| :--- | :--- | :--- |
| `face_recognition` | `faceRecognition` | `@Expose({name:'face_recognition'}) @IsOptional @IsBoolean` |
| `plate_recognition` | `plateRecognition` | `@Expose({name:'plate_recognition'}) @IsOptional @IsBoolean` |
| `people_counting` | `peopleCounting` | `@Expose({name:'people_counting'}) @IsOptional @IsBoolean` |

- Pipe route-level `ValidationPipe({ whitelist:true, forbidNonWhitelisted:false, transform:true })` (mirror `configureRtsp`).
- **Ngữ nghĩa MERGE từng cờ (ĐÃ CHỐT OQ-3)**: gửi `{face_recognition:false}` → chỉ đổi cờ đó, 2 cờ kia + `configured_at` cũ giữ nguyên. Cả 3 `@IsOptional` chính vì merge. `absent` ≠ `false` (§2).

## 4. Service — method thêm vào `IotDevicesService`

`configureAiConfig(userId, deviceId, dto)` — mirror `configureRtsp` ([§0.2](#02-configurertsp--khuôn-để-mirror)):
1. Load device; 404 `IOT_DEVICE_NOT_FOUND`.
2. Allowlist `device_type` ∈ **`AI_CONFIGURABLE_DEVICE_TYPES` (5 loại, ĐÃ CHỐT OQ-2)** — khác → 409 `DEVICE_TYPE_NOT_AI_CAPABLE`. **KHÔNG** bắt buộc `roomId`/`zoneId` (khác `configureRtsp`).
3. Đọc `ai_config` cũ; **MERGE từng cờ** dto gửi (giữ cờ không gửi) + set `configured_at`; `{ ...currentMetadata, ai_config: merged }` — giữ nguyên `rtsp_config`/`face_server_config`/khoá khác.
4. **Transaction** { save + `logConfigureAi` } (ĐÃ CHỐT OQ-5, cùng transaction, mirror rtsp).
5. Trả `savedDevice` qua `toIotDeviceResponse` (ĐÃ CHỐT OQ-7). `ai_config` không secret ⇒ không mask.
- **KHÔNG** đẩy xuống thiết bị. **KHÔNG** dùng config này ở bất kỳ luồng xử lý event nào (QĐ-2).

**Allowlist (ĐÃ CHỐT OQ-2)**: `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER` — **đúng 5 loại của allowlist UC-94** (thiết bị sinh/xử lý sự kiện AI theo vị trí). Loại trừ `MICROPHONE`, `CAPTURE_AGENT`, `DISPLAY`.

## 5. Controller — route thêm vào `IotDevicesController`

```text
PATCH /api/v1/iot-devices/:id/ai-config   → configureAiConfig
```
- `@Patch(':id/ai-config')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('iot.device.configure_ai')` (QĐ-4) · `ValidationPipe` route-level (mirror `configureRtsp`) · `@Param('id', ParseUUIDPipe)` · `@Body() ConfigureAiConfigDto` → `toIotDeviceResponse(device)`.
- 2 segment `:id/ai-config` không xung đột `@Patch(':id')` (segment sau khác) — mirror `:id/rtsp-config`.
- Thiếu `@RequirePermissions` = endpoint hở im lặng (`PermissionsGuard` return true khi không metadata).

**HTTP status**

| Tình huống | Status | code |
| :--- | ---: | :--- |
| Cấu hình thành công | `200` | — |
| Body sai (cờ không phải boolean) | `400` | (Nest validation) |
| `:id` không UUID | `400` | `ParseUUIDPipe` |
| Chưa đăng nhập | `401` | — |
| Thiếu permission | `403` | `FORBIDDEN` |
| Device không tồn tại | `404` | `IOT_DEVICE_NOT_FOUND` |
| Device type không hỗ trợ AI | `409` | `DEVICE_TYPE_NOT_AI_CAPABLE` (OQ-2) |

## 6. Requirements (EARS)

- **R1**: **WHEN** admin có permission gọi `PATCH /iot-devices/:id/ai-config` với các cờ AI **→** hệ thống ghi `metadata_json.ai_config` cho device, kèm `configured_at`, trả device.
- **R2 (crux — QĐ-2)**: **WHILE** ghi `ai_config`, hệ thống chỉ **lưu DB** — **KHÔNG** đẩy xuống thiết bị và **KHÔNG** để giá trị này ảnh hưởng bất kỳ luồng xử lý event nào (face/plate/occupancy). Event từ thiết bị được xử lý **độc lập** với `ai_config`.
- **R3**: **WHILE** ghi, hệ thống **merge** vào `metadata_json` — giữ nguyên `rtsp_config`/`face_server_config`/khoá khác (không ghi đè cả `metadata_json`).
- **R4 (SEC-02)**: route PHẢI qua `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('iot.device.configure_ai')`; thiếu permission → `403`.
- **R5**: **IF** device không tồn tại → `404`; **IF** device_type không hỗ trợ AI (OQ-2) → `409`; **IF** cờ không boolean → `400`.
- **R6**: **WHERE** thao tác thành công **→** ghi `audit_logs` (`logConfigureAi`, ĐÃ CHỐT OQ-5) trong cùng transaction với `save`; chỉ ghi 3 cờ + `deviceId` (SEC-01).
- **R7**: response **KHÔNG** lộ secret; `ai_config` không có secret nên trả nguyên (khác `rtsp_config` có `rtsp_password_encrypted`).

## 7. QUYẾT ĐỊNH ĐÃ CHỐT

1. **KHÔNG cần phần cứng** — chỉ ghi DB (RECON §0.1: 0 lời gọi HTTP). Không thiết kế kênh đẩy.
2. **⭐ Config là TUYÊN BỐ Ý ĐỊNH, KHÔNG dùng để lọc event** — BE không đẩy được xuống thiết bị ⇒ DB có thể lệch thật; camera vẫn gửi event thì vẫn xử lý bình thường. Consumer "phát hiện lệch" (không chặn) làm cùng UC-105 (ghi nợ §9).
3. **Lưu `metadata_json.ai_config`** (khoá riêng), mirror `rtsp_config`; KHÔNG bảng/cột mới.
4. **Permission dấu chấm 3 tầng** `iot.device.configure_ai` (`module_code='iot'`, `action_code='configure_ai'`); chấp nhận lệch với `configure_rtsp` dạng hai chấm (di sản), không nối dài di sản. Residual về 2 quy ước §9.
5. **KHÔNG migration schema**; migration duy nhất = seed permission `20260722000009`.
6. **Phạm vi**: KHÔNG đụng `configureRtsp`/`configureFaceServer`/method khác của `IotDevicesService`; KHÔNG đụng `zones`/`anpr`/`scheduler`.

## 8. OPEN QUESTIONS — ĐÃ CHỐT

- **OQ-1 (CRUX) — Cấu trúc `ai_config`.** *Đề xuất*: 3 cờ boolean + `configured_at`.
  → **CHỐT: 3 cờ + `configured_at`, tên nghiệp vụ (không nhãn IVSS), actor ở audit không trong JSON.** ⚠ JSDoc PHẢI map cờ → **loại event** (`face_recognition→ivss_face_event`, `plate_recognition→sự kiện biển số`, `people_counting→occupancy`) cho consumer phát-hiện-lệch (§2).
- **OQ-2 — Device type nào cấu hình được?** *Đề xuất ban đầu (agent)*: 3 loại (loại `OCCUPANCY_SENSOR`/`FACE_SERVER`).
  → **CHỐT — KHÁC đề xuất: 5 loại** `IP_CAMERA`/`DOOR_CAMERA`/`ROOM_CAMERA`/`OCCUPANCY_SENSOR`/`FACE_SERVER` (**= allowlist UC-94**, cùng tiêu chí "sinh/xử lý event AI theo vị trí"). Loại `OCCUPANCY_SENSOR` là thiết bị chính danh đếm người; `FACE_SERVER` là nơi thật chạy nhận diện mặt — loại chúng là nghịch lý. **KHÔNG** bắt buộc `roomId`/`zoneId`.
- **OQ-3 (CRUX) — Partial update hay replace cụm `ai_config`?** *Bối cảnh*: `rtsp_config` **replace toàn bộ cụm** (gửi thiếu field con → mất); UC-91 zone chốt replace. *Đề xuất*: **merge từng cờ** — gửi `{face_recognition:false}` chỉ đổi cờ đó, 2 cờ kia + `configured_at` giữ nguyên (đọc `ai_config` cũ rồi spread). Lý do: bật/tắt từng chức năng là thao tác độc lập, replace cả cụm buộc client gửi đủ 3 cờ mỗi lần → dễ vô tình reset. *Đánh đổi*: khác khuôn `rtsp_config` (replace).
  → **CHỐT: MERGE từng cờ.** ⚠ Nguyên tắc (ghi §Kỷ luật plan): **túi tự do** (metadata_json của zone — khoá không biết trước) → **REPLACE**; **cấu hình hình dạng cố định** (`ai_config` — đúng 3 khoá) → **MERGE từng khoá** (xác định, an toàn). + luật **`absent` ≠ `false`** (§2).
- **OQ-4 — Route GET đọc config riêng?** *Bối cảnh*: `GET /iot-devices/:id` đã trả cả `metadata_json` (gồm `ai_config` sau khi ghi). `rtsp_config` lộ `rtsp_password_encrypted` (đã mã hoá, không plaintext). *Đề xuất*: **KHÔNG** route GET riêng.
  → **CHỐT: KHÔNG route GET riêng** — dùng `GET /iot-devices/:id` sẵn có; `ai_config` không secret.
- **OQ-5 — Audit?** *Bối cảnh*: mọi config op đều audit (§0.5).
  → **CHỐT: CÓ** — thêm `logConfigureAi(manager, {userId, deviceId, configMetadata})`, cùng transaction, mirror `logConfigureRtsp`; chỉ ghi 3 cờ + `deviceId` (SEC-01).
- **OQ-6 — `configureFaceServer`.** → **XÁC NHẬN: KHÁC chức năng** (§0.3). Cấu hình callback/token Door Face Terminal, không phải bật/tắt AI. UC-96 KHÔNG là route còn thiếu của nó, **KHÔNG đụng/xoá**. Ghi nợ: nó có spec riêng (`feat-configure-face-server-connection`) nhưng **không route gọi** — UC của người khác làm dở, không phải việc UC-96.
- **OQ-7 — Response trả gì?** → **CHỐT: trả cả device** qua `toIotDeviceResponse` (mirror `configureRtsp`); `ai_config` không secret ⇒ không mask thêm.
- **OQ-8 — Role nào cấu hình?** → **CHỐT: `SYSTEM_ADMIN` only** — nhất quán `configure_rtsp`/`configure_face_server` (cấu hình tham số kỹ thuật). Khác UC-94 (2 role) vì gán zone là thao tác tổ chức, không phải kỹ thuật. Permission dạng dấu chấm `iot.device.configure_ai` (QĐ-4).
- **OQ-9 — Validate giá trị.** → **CHỐT: chỉ 3 cờ boolean ở v1** (`@IsOptional @IsBoolean`). KHÔNG ngưỡng/vùng — BE không đẩy được nên vô nghĩa.
- **OQ-10 — Mâu thuẫn prompt vs luật**: → **XÁC NHẬN không có mâu thuẫn mới**. QĐ-4 (dấu chấm, lệch `configure_rtsp`) là chủ đích, ghi residual. Các lệch đã biết (4 role thật, error envelope, Swagger, `spec/global/` rỗng) giữ nguyên.

## 9. Residuals / known-gaps

- **⚠⚠ Config là ý định, KHÔNG phải trạng thái thật (QĐ-2)**: BE không đẩy `ai_config` xuống camera/IVSS (§0.1) ⇒ giá trị DB **có thể lệch** cấu hình đang chạy. **CẤM** dùng `ai_config` để lọc/chặn event ở bất kỳ luồng nào — nếu không, event thật của chức năng bị khai "tắt" sẽ bị bỏ, **mất dữ liệu**. Đây là điểm người sau **rất dễ "tối ưu" sai**.
- **Phát hiện lệch cấu hình (config drift) — NỢ, làm cùng UC-105**: khi ingest event thuộc chức năng đang khai "tắt", consumer nên **ghi cảnh báo** (không chặn) để vận hành biết DB lệch thiết bị. UC-96 KHÔNG làm (chỉ ghi config).
- **Không đồng bộ 2 chiều**: nếu ai đó đổi cấu hình thẳng trên IVSS, DB `ai_config` không biết. Đồng bộ kéo về (nếu IVSS có API đọc) là UC tương lai, cần kênh HTTP mà BE hiện chưa có.
- **Quy ước permission `iot` lệch (QĐ-4)**: module `iot` có **2 dạng** — `iot_devices:x` (di sản, họ config/create) và `iot.device.x` (mới). UC-96 dùng dấu chấm `iot.device.configure_ai`, **lệch** với anh em `iot_devices:configure_rtsp`. Chấp nhận để không nối dài di sản; chuẩn hoá toàn module về 1 dạng là refactor riêng.
- **`configureFaceServer` vẫn là code chết** (0 caller) — khác chức năng UC-96, có spec riêng chưa wire route; không thuộc UC-96.
- **Nợ hệ thống**: global exception filter, Swagger, 5 file `spec/global/` rỗng — giữ nguyên.

---

> **STOP.** Spec-only. OQ-1→OQ-10 **ĐÃ CHỐT** (§8). 6 QĐ §7 KHÔNG mở lại (đặc biệt QĐ-2). Đã sang bước **plan** ([plan.md](./plan.md)). Chưa viết code/`tasks.md`, chưa chạy migration/seed/test/build, chưa commit.
