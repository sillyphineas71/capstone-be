# IAC-001 — plan.md (UC-96 IoT: cấu hình chức năng AI của camera)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan IAC-001 sau spec DUYỆT + chốt OQ-1→OQ-10. `PATCH /iot-devices/:id/ai-config` → `configureAiConfig` (net-new method) ghi `metadata_json.ai_config`, **MERGE từng cờ**, allowlist **5 loại** (=UC-94), transaction + audit `logConfigureAi`, trả cả device, `SYSTEM_ADMIN` only, permission `iot.device.configure_ai`. Hằng `AI_CONFIGURABLE_DEVICE_TYPES`. Migration seed `20260722000009`. **KHÔNG** đụng `configureRtsp`/`configureFaceServer`/method khác; KHÔNG dùng config lọc event (QĐ-2); `absent`≠`false`; túi-tự-do→replace / hình-dạng-cố-định→merge. | Toàn bộ |
| 2026-07-23 | Sửa quyết định "body rỗng": **no-op theo GIÁ TRỊ THẬT** (dùng chung UC-91/UC-94) thay vì "200 chỉ cập nhật configured_at". So `merged` (bỏ `configured_at`) với `ai_config` hiện tại — giống ⇒ KHÔNG `save`/audit/transaction/`configured_at`. Bỏ hẳn nhánh đặc biệt-hoá empty (`{}` tự rơi vào no-op). Lý do: "chỉ cập nhật configured_at" vẫn `save`+audit ⇒ phình `audit_logs` khi PATCH lặp, `configured_at` mất nghĩa "lần đổi thật cuối". Cập nhật §3/§4/§8/§10. | §3, §4, §8, §10 |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 6 QĐ §7 + 10 OQ đã chốt.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- **`configureRtsp` — khuôn mirror** ([iot-devices.service.ts:1119-1235](../../../../src/modules/iot/services/iot-devices.service.ts)):
  - Load `findOne(IoTDeviceEntity, {where:{id}})`; 404 `IOT_DEVICE_NOT_FOUND` ([:1128-1133](../../../../src/modules/iot/services/iot-devices.service.ts)).
  - Allowlist `deviceType` (RTSP: `IP_CAMERA`||`ROOM_CAMERA` → khác 409 `DEVICE_TYPE_NOT_RTSP_CAMERA`) ([:1135-1143](../../../../src/modules/iot/services/iot-devices.service.ts)).
  - `const currentMetadata = device.metadataJson || {}` ([:1152](../../../../src/modules/iot/services/iot-devices.service.ts)); `const currentRtspConfig = (currentMetadata.rtsp_config as any) || {}` ([:1153](../../../../src/modules/iot/services/iot-devices.service.ts)) — **đọc cụm cũ để carry-over** (đây chính là chỗ MERGE cho UC-96).
  - `device.metadataJson = { ...currentMetadata, rtsp_config: newRtspConfig }` ([:1202-1207](../../../../src/modules/iot/services/iot-devices.service.ts)).
  - Transaction: `qr = createQueryRunner(); connect(); startTransaction(); try { save; logConfigureRtsp(qr.manager, {...}); commit; return saved } catch { rollback; throw } finally { release() }` ([:1209-1234](../../../../src/modules/iot/services/iot-devices.service.ts)).
- **Controller handler** ([iot-devices.controller.ts:181-205](../../../../src/modules/iot/controllers/iot-devices.controller.ts)): `@Patch(':id/rtsp-config')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('iot_devices:configure_rtsp')` · `@UsePipes(new ValidationPipe({whitelist:true, forbidNonWhitelisted:false, transform:true}))` · `userId = req.user?.userId ?? ...` · `@Param('id', ParseUUIDPipe)` · `@Body() dto` → `{ success:true, message, data: toIotDeviceResponse(device) }`.
- **`logConfigureRtsp` chữ ký** ([iot-audit.repository.ts:166-189](../../../../src/modules/iot/repositories/iot-audit.repository.ts)): `(entityManager, {userId, deviceId, configMetadata, passwordProvided})` → `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json) VALUES ($1, 'configure_rtsp', 'iot_devices', $2, 'info', $3::jsonb)`; strip secret trước ghi. ⇒ `logConfigureAi` mirror: `action_type='configure_ai'`, `configMetadata` = 3 cờ (không secret nên không strip).
- **`toIotDeviceResponse`**: trả cả `metadata_json` (secret RTSP đã mã hoá tại tầng ghi, không plaintext); `ai_config` không secret ⇒ an toàn.
- **`IoTDeviceType`** đủ 5 giá trị allowlist ([iot-device.entity.ts:13-22](../../../../src/modules/iot/entities/iot-device.entity.ts)): `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER` (+ `MICROPHONE`/`CAPTURE_AGENT`/`DISPLAY` loại trừ).
- **Allowlist UC-94** để đối chiếu: `ZONE_ASSIGNABLE_DEVICE_TYPES` (assign-zone-devices) = đúng 5 loại trên. UC-96 dùng cùng danh sách + cùng tiêu chí.
- **Mẫu seed** ([20260722000007-SeedGateLogReadPermission.ts](../../../../src/database/migrations/20260722000007-SeedGateLogReadPermission.ts)): 6 cột, `action_code` tường minh, `ON CONFLICT DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước.
- **Permission `iot_devices:configure_rtsp` role** = `['SYSTEM_ADMIN']` ([20260720000005:298-303](../../../../src/database/migrations/20260720000005-BackfillRolePermissions.ts)) ⇒ UC-96 `SYSTEM_ADMIN` only (OQ-8).
- **Mốc**: migration cuối `20260722000008` ⇒ UC-96 **`20260722000009`** (T0 đếm lại). Baseline `iot` **11 suite / 172 test**.
- Chưa có DTO/mapper/route cho AI config (kỳ vọng đúng).

## 1. Quyết định đã chốt (OQ + §7 + Constitution)

**OQ**: 3 cờ + configured_at, tên nghiệp vụ, map→event (OQ-1) · allowlist 5 loại, không bắt roomId (OQ-2) · **MERGE từng cờ** + `absent`≠`false` (OQ-3) · không GET riêng (OQ-4) · audit `logConfigureAi` cùng transaction (OQ-5) · configureFaceServer khác chức năng, không đụng (OQ-6) · trả cả device (OQ-7) · SYSTEM_ADMIN only (OQ-8) · chỉ boolean (OQ-9).

**§7 nền**: không phần cứng · config = ý định KHÔNG lọc event (QĐ-2) · lưu metadata_json.ai_config · permission dấu chấm `iot.device.configure_ai` · KHÔNG migration schema · không đụng method khác/module khác.

- **SEC-01**: audit chỉ ghi 3 cờ + deviceId, không ghi phần khác của `metadata_json`.
- **SEC-02**: route gate `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('iot.device.configure_ai')`.
- **SEC-03**: `:id` `ParseUUIDPipe`; DTO validate boolean; không nối chuỗi SQL (audit dùng bound param `$n`).
- **ARCH-02**: transaction { save + audit } cùng sống/cùng chết.
- **ARCH-03**: MERGE + `configured_at` — chạy lại cùng body → cùng kết quả (idempotent về cờ).

## 2. Constants — `AI_CONFIGURABLE_DEVICE_TYPES`

File net-new `src/modules/iot/constants/ai-configurable-device-types.constant.ts` (hoặc gộp vào constants iot hiện có — T0 kiểm thư mục):
```
export const AI_CONFIGURABLE_DEVICE_TYPES = [
  IoTDeviceType.IP_CAMERA,
  IoTDeviceType.DOOR_CAMERA,
  IoTDeviceType.ROOM_CAMERA,
  IoTDeviceType.OCCUPANCY_SENSOR,
  IoTDeviceType.FACE_SERVER,
] as const;
```
- JSDoc: **cùng tiêu chí và cùng danh sách với allowlist UC-94** (`ZONE_ASSIGNABLE_DEVICE_TYPES`) — "thiết bị sinh/xử lý sự kiện AI theo vị trí". Một quy tắc, hai chỗ dùng.

## 3. DTO

File net-new `src/modules/iot/dto/configure-ai-config.dto.ts` — `ConfigureAiConfigDto`:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `faceRecognition?: boolean` | `face_recognition` | `@Expose({name:'face_recognition'}) @IsOptional @IsBoolean` |
| `plateRecognition?: boolean` | `plate_recognition` | `@Expose({name:'plate_recognition'}) @IsOptional @IsBoolean` |
| `peopleCounting?: boolean` | `people_counting` | `@Expose({name:'people_counting'}) @IsOptional @IsBoolean` |

- **JSDoc BẮT BUỘC 3 mục**:
  1. **Map cờ → LOẠI EVENT** (cho consumer phát-hiện-lệch UC-105): `face_recognition→ivss_face_event`, `plate_recognition→vehicle plate event`, `people_counting→occupancy event`. KHÔNG dùng nhãn UI IVSS.
  2. **Ngữ nghĩa MERGE**: cờ gửi → cập nhật; cờ không gửi → giữ nguyên (không reset).
  3. **`absent` ≠ `false`**: vắng mặt = chưa khai; `false` = khai tắt. KHÔNG mặc định absent thành false.
- **No-op theo GIÁ TRỊ THẬT (CHỐT — dùng chung UC-91/UC-94)**: sau merge, so `merged` (bỏ `configured_at`) với `ai_config` **hiện tại**. **Giống** ⇒ no-op hoàn toàn: KHÔNG `save`, KHÔNG audit, KHÔNG đụng `configured_at`, KHÔNG mở transaction; trả `200` + device nguyên trạng. **Khác** ⇒ set `configured_at` mới + transaction (§4). ⇒ Body rỗng `{}` **tự rơi vào no-op** (`merged === current`) — **KHÔNG** cần nhánh đặc biệt hoá empty. Ca PATCH cờ trùng giá trị đang có cũng no-op (không phình `audit_logs`, `configured_at` chỉ nhảy khi đổi thật).

## 4. Service — method thêm vào `IotDevicesService`

**File Modified**: `src/modules/iot/services/iot-devices.service.ts` — **chỉ THÊM** `configureAiConfig`, KHÔNG đụng method khác.

`async configureAiConfig(userId: string | null, deviceId: string, dto: ConfigureAiConfigDto): Promise<IoTDeviceEntity>`:
1. `const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {where:{id:deviceId}})`; 404 `IOT_DEVICE_NOT_FOUND`.
2. `if (!AI_CONFIGURABLE_DEVICE_TYPES.includes(device.deviceType))` → 409 `DEVICE_TYPE_NOT_AI_CAPABLE` ("This device type does not support AI configuration."). **KHÔNG** bắt `roomId`/`zoneId`.
3. `const currentMetadata = device.metadataJson || {}`; `const currentAiConfig = (currentMetadata.ai_config as Record<string, unknown>) || {}`.
4. **MERGE từng cờ** (chỉ khoá `!== undefined` mới ghi đè) — **CHƯA** đụng `configured_at` ở bước này:
   ```
   const merged = { ...currentAiConfig };
   if (dto.faceRecognition !== undefined) merged.face_recognition = dto.faceRecognition;
   if (dto.plateRecognition !== undefined) merged.plate_recognition = dto.plateRecognition;
   if (dto.peopleCounting !== undefined) merged.people_counting = dto.peopleCounting;
   ```
5. **⭐ So sánh giá trị thật (no-op — dùng chung UC-91/UC-94)**: so `merged` với `currentAiConfig` **BỎ QUA `configured_at`** (chỉ 3 cờ). **Giống nhau** ⇒ **return `device` NGUYÊN TRẠNG ngay** — KHÔNG set `configured_at`, KHÔNG mở transaction, KHÔNG `save`, KHÔNG audit. (Body rỗng tự rơi vào đây.)
6. **Khác nhau** → `merged.configured_at = new Date().toISOString()`; `device.metadataJson = { ...currentMetadata, ai_config: merged }`.
   ⚠ **KHÔNG** đụng `rtsp_config`/`face_server_config`/`last_availability_check`/khoá khác của `metadata_json` (spread `...currentMetadata` giữ nguyên).
7. Transaction: `qr.connect(); startTransaction(); try { saved = save; await this.iotAuditRepository.logConfigureAi(qr.manager, {userId, deviceId: saved.id, configMetadata: merged}); commit; return saved } catch { rollback; throw } finally { release() }`.
8. Trả `savedDevice` (controller map `toIotDeviceResponse`).
- **KHÔNG** đẩy xuống thiết bị; **KHÔNG** dùng config ở luồng event nào (QĐ-2).

## 5. Audit — method thêm vào `IotAuditRepository`

**File Modified**: `src/modules/iot/repositories/iot-audit.repository.ts` — thêm `logConfigureAi`, mirror `logConfigureRtsp`:
```
async logConfigureAi(entityManager, params: { userId: string | null; deviceId: string; configMetadata: Record<string, any> }): Promise<void> {
  await entityManager.query(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
     VALUES ($1, 'configure_ai', 'iot_devices', $2, 'info', $3::jsonb)`,
    [params.userId, params.deviceId, JSON.stringify(params.configMetadata)],
  );
}
```
- `configMetadata` = cụm `ai_config` đã merge (3 cờ + configured_at) — không secret, không cần strip (SEC-01: chỉ 3 cờ + deviceId, KHÔNG ghi `rtsp_config`/khoá khác vì chỉ truyền `merged`).

## 6. Controller — route thêm vào `IotDevicesController`

**File Modified**: `src/modules/iot/controllers/iot-devices.controller.ts` — thêm import `ConfigureAiConfigDto`, thêm 1 route.
```text
PATCH /api/v1/iot-devices/:id/ai-config   → configureAiConfig
```
- `@Patch(':id/ai-config')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('iot.device.configure_ai')` · `@UsePipes(new ValidationPipe({whitelist:true, forbidNonWhitelisted:false, transform:true}))` (mirror `configureRtsp` route-level) · `@Req() req` (lấy `userId`) hoặc `@CurrentUser()` (theo style file — T0 kiểm; `configureRtsp` dùng `req.user?.userId`) · `@Param('id', ParseUUIDPipe)` · `@Body() ConfigureAiConfigDto` → `{ success:true, message:'AI configuration updated successfully', data: toIotDeviceResponse(device) }`.
- **Thứ tự khai / xung đột**: `:id/ai-config` (2 segment) vs `@Patch(':id')` (1 segment) — **khác số segment**, KHÔNG xung đột. So với các route `:id/...` khác (`:id/rtsp-config`, `:id/assign-room`...): **cùng prefix `:id` nhưng segment sau là literal khác nhau** (`ai-config` ≠ `rtsp-config`) ⇒ KHÔNG xung đột (tiêu chí: cùng prefix + `:param` mới nuốt; ở đây segment sau đều literal). Khai cạnh `:id/rtsp-config` cho nhất quán.
- ⚠ Thiếu `@RequirePermissions` = endpoint hở im lặng.

**HTTP status**: 200 (thành công / body rỗng no-op) · 400 (cờ không boolean / `:id` không UUID) · 401 · 403 (thiếu permission) · 404 (device không tồn tại) · 409 (`DEVICE_TYPE_NOT_AI_CAPABLE`).

## 7. File list

### Net-new
**Code (3)**
- `src/modules/iot/constants/ai-configurable-device-types.constant.ts`
- `src/modules/iot/dto/configure-ai-config.dto.ts`
- `src/database/migrations/20260722000009-SeedIotConfigureAiPermission.ts` — seed `iot.device.configure_ai` (`module_code='iot'`, `action_code='configure_ai'`), **1 role `SYSTEM_ADMIN`**; mirror `20260722000007`. ⚠ số thứ tự verify T0.

**Test (3)**
- `configure-ai-config.dto.spec.ts`
- (service test) thêm `describe('configureAiConfig')` vào `iot-devices.service.spec.ts` (Modified — xem dưới)
- (controller test) thêm vào `iot-devices.controller.spec.ts` (Modified)

### Modified
- `src/modules/iot/services/iot-devices.service.ts` — thêm `configureAiConfig` (+ import hằng/DTO). KHÔNG đụng method khác.
- `src/modules/iot/repositories/iot-audit.repository.ts` — thêm `logConfigureAi`.
- `src/modules/iot/controllers/iot-devices.controller.ts` — thêm 1 route + import DTO.
- `src/modules/iot/services/iot-devices.service.spec.ts` — thêm test `configureAiConfig`.
- `src/modules/iot/controllers/iot-devices.controller.spec.ts` — thêm test route + assert permission metadata.

> Tổng **3 net-new code + 1 net-new test (DTO spec) + 4 modified (2 code + 2 test) + 1 modified (audit repo)**. **0 migration schema**. `IoTDeviceEntity`, `toIotDeviceResponse`, `configureRtsp`/`configureFaceServer`/method khác, `iot.module.ts` (nếu không phát sinh provider mới — audit repo + service đã đăng ký) **KHÔNG đổi**.

## 8. Test (mock repo — KHÔNG DB)

**`iot-devices.service.spec.ts` — `describe('configureAiConfig')`** (mock `dataSource.manager.findOne` + `createQueryRunner` chainable + `iotAuditRepository.logConfigureAi`):
- **MERGE giữ cờ kia**: device có `ai_config={face_recognition:true, plate_recognition:true}`; gửi `{peopleCounting:false}` → `metadata_json.ai_config` = `{face_recognition:true, plate_recognition:true, people_counting:false, configured_at}`.
- **`absent` KHÔNG thành `false`**: gửi `{faceRecognition:true}` khi chưa có `ai_config` → chỉ `face_recognition:true` + `configured_at`; **KHÔNG** có `plate_recognition`/`people_counting` (không auto-false).
- **Lần PATCH đầu** (device `metadata_json` null hoặc không có `ai_config`) → tạo `ai_config` mới với các cờ gửi.
- **KHÔNG đụng khoá khác**: device có `metadata_json={rtsp_config:{...}, face_server_config:{...}}`; sau PATCH → `rtsp_config`/`face_server_config` **nguyên vẹn**, chỉ thêm `ai_config`.
- **Device type ngoài allowlist** (`MICROPHONE`) → 409 `DEVICE_TYPE_NOT_AI_CAPABLE`, KHÔNG save.
- **Device không tồn tại** (findOne null) → 404 `IOT_DEVICE_NOT_FOUND`.
- **Audit cùng transaction**: `logConfigureAi` gọi với `{userId, deviceId, configMetadata=merged}`; `commit` gọi sau; `configMetadata` chỉ chứa cờ ai_config (không `rtsp_config`).
- **`finally release()`**: gọi ở nhánh thành công + nhánh lỗi (save ném → rollback + release).
- **⭐ No-op body rỗng** (`{}`) → 200, trả device nguyên trạng; assert **`save` KHÔNG gọi, `logConfigureAi` KHÔNG gọi, `createQueryRunner` KHÔNG gọi, `configured_at` KHÔNG đổi**.
- **⭐ No-op cờ trùng giá trị hiện tại**: device có `ai_config={face_recognition:true}`; gửi `{faceRecognition:true}` → no-op (giống trên: 0 save, 0 audit, 0 transaction, `configured_at` giữ nguyên).
- **Có đổi thật → transaction chạy**: gửi cờ đổi giá trị → `save` + `logConfigureAi` + `commit` gọi, `configured_at` mới.
- **5 loại allowlist** đều qua bước type-check (ít nhất assert 1 loại đại diện mỗi nhóm: camera + OCCUPANCY_SENSOR + FACE_SERVER).

**`configure-ai-config.dto.spec.ts`**:
- 3 cờ optional: `{}` → 0 lỗi; từng cờ boolean hợp lệ → 0 lỗi.
- cờ không boolean (`face_recognition:'yes'`) → `isBoolean`.
- `@Expose`: gửi `{face_recognition:true}` → property `faceRecognition===true`.
- whitelist: gửi khoá lạ → bị loại (nếu forbidNonWhitelisted:false thì chỉ strip, không 400).

**`iot-devices.controller.spec.ts`**:
- route gọi `service.configureAiConfig(userId, id, dto)`; envelope + `toIotDeviceResponse`.
- Metadata `PERMISSIONS_KEY` = `['iot.device.configure_ai']`; guard `JwtAuthGuard`+`PermissionsGuard`.
- **Không hồi quy**: route `rtsp-config`/`assign-room`/... cũ vẫn xanh.

**Nguyên tắc**: 100% mock; **172 test cũ không hồi quy**.

## 9. Gate (STOP, KHÔNG commit)

- `npm run build` = 0 error; eslint **chỉ file touched** = 0 rule mới (KHÔNG `npm run lint` trần).
- `npx jest src/modules/iot` xanh — **172 test cũ không hồi quy** + test mới.
- Coverage phần `configureAiConfig` + `logConfigureAi` ≥80%.
- **DI-proof**: `AppModule` preview mode — 0 `UnknownDependenciesException`, 0 circular (module không đổi wiring nhưng service/controller/repo sửa nên vẫn chạy).
- **KHÔNG** `migration:run` (kể cả local), **KHÔNG** RDS, **KHÔNG** live smoke, **KHÔNG** commit.
- **Bàn giao**: gọi `PATCH /iot-devices/:id/ai-config` local cần seed `20260722000009` trước; thiếu → 403. Config **chỉ ghi DB**, không đẩy xuống camera; drift-detection là UC-105.
- **Owed**: consumer phát-hiện-lệch cấu hình (UC-105) · đồng bộ 2 chiều IVSS (cần kênh HTTP BE chưa có) · chuẩn hoá 2 quy ước permission `iot` · `configureFaceServer` code chết (spec riêng) · global exception filter · Swagger · 5 file `spec/global/` rỗng.

## 10. Kỷ luật

- **(a) ⚠⚠ Config là TUYÊN BỐ Ý ĐỊNH — CẤM dùng lọc/chặn event** (QĐ-2): BE không đẩy được xuống thiết bị ⇒ DB có thể lệch thật. Camera khai "tắt" mà vẫn gửi event → **vẫn xử lý bình thường**. Người sau CẤM "tối ưu" bằng cách lọc event theo `ai_config` (mất dữ liệu). `ai_config` KHÔNG xuất hiện trong bất kỳ luồng xử lý event nào.
- **(b) Nguyên tắc MERGE vs REPLACE**: **túi tự do** (khoá không biết trước, vd `metadata_json` của zone) → **REPLACE**; **cấu hình hình dạng cố định** (`ai_config` — đúng 3 khoá) → **MERGE từng khoá**. Merge trên hình dạng cố định là xác định; merge trên túi tự do thì không bao giờ xoá được khoá.
- **(c) `absent` ≠ `false`**: khoá vắng mặt = admin chưa khai; `false` = khai tắt. KHÔNG mặc định absent→false. Consumer chỉ cảnh báo khi cờ `false` tường minh.
- **(d) Allowlist 5 loại dùng chung tiêu chí UC-94** (`ZONE_ASSIGNABLE_DEVICE_TYPES`) — thiết bị sinh/xử lý event AI theo vị trí. Một quy tắc, hai chỗ dùng.
- **(e) Permission dấu chấm** `iot.device.configure_ai`, lệch `iot_devices:configure_rtsp` (di sản hai chấm) là **chủ đích** — không nối dài di sản; chuẩn hoá module là refactor riêng.
- **(f) Map cờ → loại event** (không nhãn IVSS): `face_recognition→ivss_face_event`, `plate_recognition→plate event`, `people_counting→occupancy` — cho consumer drift-detection.
- **(g) KHÔNG đụng** `configureRtsp`/`configureFaceServer`/method khác của `IotDevicesService`, entity, `toIotDeviceResponse`, module `zones`/`anpr`/`scheduler`. `configureFaceServer` code chết giữ nguyên.
- **(h) No-op theo GIÁ TRỊ THẬT**: so `merged` (bỏ `configured_at`) với `ai_config` hiện tại — giống ⇒ KHÔNG `save`, KHÔNG audit, KHÔNG mở transaction, KHÔNG đụng `configured_at`. `configured_at` chỉ nhảy khi cờ **đổi thật**; `audit_logs` không phình vì PATCH lặp. Nguyên tắc so-sánh-giá-trị-thật dùng chung UC-91 (`update`) và UC-94 (`assignDevices`). Body rỗng tự rơi vào no-op — KHÔNG nhánh đặc biệt.

> **STOP.** Plan-only. Chưa code, chưa `tasks.md`, chưa chạy migration/seed/test/build, chưa commit. Chờ Thiếu Chủ duyệt plan → sang tasks.
