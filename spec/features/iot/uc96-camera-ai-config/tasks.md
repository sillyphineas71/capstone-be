# IAC-001 — tasks.md (UC-96 IoT: cấu hình chức năng AI của camera)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks IAC-001 sau plan DUYỆT + sửa "body rỗng → no-op theo GIÁ TRỊ THẬT": T0 verify → T1/T1b constant `AI_CONFIGURABLE_DEVICE_TYPES` (5 loại =UC-94) → T2/T2b DTO `ConfigureAiConfigDto` → T3/T3b audit `logConfigureAi` → T4/T4b service `configureAiConfig` (MERGE + **so-sánh-giá-trị no-op**) → T5/T5b controller `PATCH :id/ai-config` → T6 migration seed `iot.device.configure_ai` (**1 role SYSTEM_ADMIN**) → T-GATE. ⚠ Module `iot` (không phải zones); config chỉ ghi DB, KHÔNG lọc event (QĐ-2). | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại 6 QĐ (spec §7), 10 OQ đã chốt, plan §10. **KHÔNG** đụng `configureRtsp`/`configureFaceServer`/`countByZoneId`/`setZoneForDevices`/`findAssignableByIds`/method khác của `IotDevicesService`, entity, `toIotDeviceResponse`, `IotModule`, `app.module.ts`, `data-source.ts`, module `zones`/`anpr`/`scheduler`. **KHÔNG** migration schema. **KHÔNG** đường đẩy config xuống thiết bị. **KHÔNG** dùng `ai_config` lọc/chặn event.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T-GATE.

> **Phụ thuộc**: constant (T1) trước DTO/service · DTO (T2) trước service (T4) + controller (T5) · audit (T3) trước service (T4 gọi `logConfigureAi`) · service (T4) trước controller (T5) · migration (T6) độc lập nhưng **cùng commit** với controller (thiếu seed = 403).
>
> **KHÔNG có task wiring module** — `IotModule` đã có `IotDevicesService` + `IotAuditRepository`. **KHÔNG** task audit-của-UC (đây là read/write config, audit đã nằm trong T3).

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu. Dán xác nhận từng mục kèm bằng chứng. **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test module `iot`**: `npx jest src/modules/iot` — **kỳ vọng 11 suite / 172 test**. Lệch → ghi nhận và báo **trước khi** code. Đối chiếu không hồi quy ở T-GATE.
2. **`IoTDeviceType`** đủ **5 giá trị** allowlist ([iot-device.entity.ts:13-22](../../../../src/modules/iot/entities/iot-device.entity.ts)): `IP_CAMERA`, `DOOR_CAMERA`, `ROOM_CAMERA`, `OCCUPANCY_SENSOR`, `FACE_SERVER` (+ `MICROPHONE`/`CAPTURE_AGENT`/`DISPLAY` loại). Dán enum thật.
3. **`configureRtsp`** ([iot-devices.service.ts:1119-1235](../../../../src/modules/iot/services/iot-devices.service.ts) + [controller:181-205](../../../../src/modules/iot/controllers/iot-devices.controller.ts)): xác nhận mở transaction (`createQueryRunner→connect→startTransaction→try{save;audit;commit}catch{rollback;throw}finally{release}`), ghi `metadata_json` bằng `{ ...currentMetadata, rtsp_config: new }` (spread giữ khoá khác), gọi audit trong transaction, response `toIotDeviceResponse(device)`, `userId = req.user?.userId ?? ...`.
4. **`IotAuditRepository.logConfigureRtsp`** chữ ký ([iot-audit.repository.ts:166-189](../../../../src/modules/iot/repositories/iot-audit.repository.ts)): `(entityManager: EntityManager, {userId, deviceId, configMetadata, passwordProvided})` → INSERT `audit_logs` bound param. `logConfigureAi` mirror (không `passwordProvided`).
5. **`toIotDeviceResponse`** — mask gì (đặc biệt `rtsp_password_encrypted` đã mã hoá); xác nhận trả cả `metadata_json` an toàn (ai_config không secret).
6. **`iot-devices.controller.ts`** — route `:id/...` hiện có (`:id`, `:id/rtsp-config`, `:id/assign-room`, `:id/face-server/revoke|rotate`, `:id/disable|enable`, `:id/check-availability`) + thứ tự; xác nhận `:id/ai-config` **không xung đột** (segment sau literal khác nhau, không phải `:param` — tiêu chí cùng-prefix+`:param` mới nuốt).
7. **Permission `iot.*`** — dạng chấm (`iot.device.*`) vs hai chấm (`iot_devices:*`) + role; xác nhận **`iot.device.configure_ai` CHƯA tồn tại**.
8. **Migration cuối thực tế**: đếm `src/database/migrations/` — kỳ vọng `20260722000008` ⇒ UC-96 lấy **`20260722000009`**. Đã có `...0009*` → lấy số kế tiếp, **ghi rõ**.
9. **Mẫu seed** [20260722000007-SeedGateLogReadPermission.ts](../../../../src/database/migrations/20260722000007-SeedGateLogReadPermission.ts) — 6 cột, `action_code` tường minh, `ON CONFLICT DO NOTHING RETURNING id` + fallback SELECT, `down()` xoá `role_permissions` trước.

- **AC**: dán xác nhận đủ **9 mục**; mục 1 ghi baseline; mục 2 dán enum; mục 3 khẳng định pattern transaction+merge; mục 7 khẳng định `configure_ai` chưa có; mục 8 chốt timestamp.

## T1 — Constant `AI_CONFIGURABLE_DEVICE_TYPES` (code) — plan §2, OQ-2
File net-new `src/modules/iot/constants/ai-configurable-device-types.constant.ts` (T0 kiểm có thư mục `constants/` chưa):
```
export const AI_CONFIGURABLE_DEVICE_TYPES = [
  IoTDeviceType.IP_CAMERA, IoTDeviceType.DOOR_CAMERA, IoTDeviceType.ROOM_CAMERA,
  IoTDeviceType.OCCUPANCY_SENSOR, IoTDeviceType.FACE_SERVER,
] as const;
```
- JSDoc: **trùng danh sách VÀ tiêu chí với `ZONE_ASSIGNABLE_DEVICE_TYPES` của UC-94** — "thiết bị sinh/xử lý sự kiện AI theo vị trí". Một quy tắc, hai chỗ dùng.
- **AC**: đúng 5 loại `as const`; JSDoc nêu trùng UC-94; loại `MICROPHONE`/`CAPTURE_AGENT`/`DISPLAY`.

## T1b — Test constant (gộp vào T2b hoặc riêng — nêu rõ)
- Assert `AI_CONFIGURABLE_DEVICE_TYPES` đúng 5 loại, không chứa `MICROPHONE`/`CAPTURE_AGENT`/`DISPLAY`. **AC**: ≥1 assert giá trị hằng đủ 5 loại.

## T2 — DTO `ConfigureAiConfigDto` (code) — plan §3, OQ-1/3/9
File net-new `src/modules/iot/dto/configure-ai-config.dto.ts`:

| Property | Field API | Decorator |
| :--- | :--- | :--- |
| `faceRecognition?: boolean` | `face_recognition` | `@Expose({name:'face_recognition'}) @IsOptional @IsBoolean` |
| `plateRecognition?: boolean` | `plate_recognition` | `@Expose({name:'plate_recognition'}) @IsOptional @IsBoolean` |
| `peopleCounting?: boolean` | `people_counting` | `@Expose({name:'people_counting'}) @IsOptional @IsBoolean` |

- **JSDoc BẮT BUỘC 3 mục**: (a) **map cờ → LOẠI EVENT** (`face_recognition→ivss_face_event`, `plate_recognition→vehicle plate event`, `people_counting→occupancy event`) cho consumer phát-hiện-lệch UC-105, KHÔNG dùng nhãn UI IVSS; (b) **ngữ nghĩa MERGE** (cờ gửi → cập nhật; không gửi → giữ nguyên); (c) **`absent` ≠ `false`** (vắng mặt = chưa khai; false = khai tắt; KHÔNG auto-false).
- **AC**: đúng 3 cờ `@IsOptional @IsBoolean` + `@Expose`; JSDoc đủ 3 mục; 0 field khác.

## T2b — Test DTO — plan §8
File net-new `configure-ai-config.dto.spec.ts`:
- `{}` → 0 lỗi (cả 3 optional); từng cờ boolean hợp lệ → 0 lỗi.
- cờ không boolean (`face_recognition:'yes'`) → `isBoolean`.
- `@Expose`: gửi `{face_recognition:true}` → property `faceRecognition===true`.
- whitelist: `ValidationPipe({whitelist:true,forbidNonWhitelisted:false,transform:true}).transform({face_recognition:true, junk:1})` → loại `junk`, giữ `faceRecognition`.
- **AC**: các case xanh; case isBoolean + @Expose + whitelist bắt buộc.

## T3 — Audit `logConfigureAi` (code) — plan §5, OQ-5, SEC-01
File **Modified**: `src/modules/iot/repositories/iot-audit.repository.ts` — **thêm** method, giữ nguyên các method cũ:
```
async logConfigureAi(entityManager: EntityManager, params: { userId: string | null; deviceId: string; configMetadata: Record<string, any> }): Promise<void> {
  await entityManager.query(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
     VALUES ($1, 'configure_ai', 'iot_devices', $2, 'info', $3::jsonb)`,
    [params.userId, params.deviceId, JSON.stringify(params.configMetadata)],
  );
}
```
- `configMetadata` = cụm `ai_config` merged (3 cờ + configured_at) — **SEC-01: chỉ 3 cờ + deviceId, KHÔNG** ghi `rtsp_config`/khoá khác (service chỉ truyền `merged`). Không secret nên không strip.
- **AC**: method mới `action_type='configure_ai'`, `entity_type='iot_devices'`, bound param `$1/$2/$3::jsonb`; nhận `EntityManager`; 0 đụng method cũ.

## T3b — Test audit — plan §8
Thêm test cho `logConfigureAi` (mock `EntityManager.query`):
- gọi `query` 1 lần với SQL chứa `'configure_ai'`, `'iot_devices'`, params `[userId, deviceId, JSON.stringify(configMetadata)]`.
- **AC**: assert action_type + params đúng.

## T4 — Service `configureAiConfig` (code) — plan §4, §2 prompt (no-op giá trị)
File **Modified**: `src/modules/iot/services/iot-devices.service.ts` — **chỉ THÊM** method (+ import hằng/DTO). KHÔNG đụng method khác.

`async configureAiConfig(userId: string | null, deviceId: string, dto: ConfigureAiConfigDto): Promise<IoTDeviceEntity>`:
1. `findOne(IoTDeviceEntity,{where:{id:deviceId}})`; null → 404 `IOT_DEVICE_NOT_FOUND`.
2. `if (!AI_CONFIGURABLE_DEVICE_TYPES.includes(device.deviceType))` → 409 `DEVICE_TYPE_NOT_AI_CAPABLE`. **KHÔNG** bắt `roomId`/`zoneId`.
3. `const currentMetadata = device.metadataJson || {}`; `const currentAiConfig = (currentMetadata.ai_config as Record<string,unknown>) || {}`.
4. **MERGE từng cờ** (`!== undefined` mới ghi đè) — CHƯA đụng `configured_at`.
5. **⭐ SO SÁNH GIÁ TRỊ THẬT** (§2 prompt): so `merged` với `currentAiConfig` **bỏ qua `configured_at`** (chỉ 3 cờ). **Giống** ⇒ **return device NGUYÊN TRẠNG ngay** — KHÔNG set `configured_at`, KHÔNG `createQueryRunner`, KHÔNG `save`, KHÔNG audit. (Body rỗng tự rơi vào đây — KHÔNG nhánh đặc biệt.)
6. **Khác** → `merged.configured_at = new Date().toISOString()`; `device.metadataJson = { ...currentMetadata, ai_config: merged }` (⚠ giữ nguyên `rtsp_config`/`face_server_config`/`last_availability_check`/khoá khác).
7. Transaction: `qr.connect(); startTransaction(); try { saved=save; await this.iotAuditRepository.logConfigureAi(qr.manager, {userId, deviceId:saved.id, configMetadata:merged}); commit; return saved } catch { rollback; throw } finally { release() }`.
- **AC**: 404/409 đúng; MERGE giữ cờ không gửi; **no-op khi giống (0 save/audit/transaction)**; đổi thật → transaction+audit; KHÔNG đụng khoá khác `metadata_json`; `finally release()`; 0 đụng method khác.

## T4b — Test service — plan §8 (đã cập nhật)
Thêm `describe('configureAiConfig')` vào `iot-devices.service.spec.ts` (mock `dataSource.manager.findOne` + `createQueryRunner` chainable + `iotAuditRepository.logConfigureAi`):
- **MERGE giữ cờ kia**: `ai_config={face_recognition:true, plate_recognition:true}`, gửi `{peopleCounting:false}` → merged 3 cờ đúng, `save` gọi.
- **`absent` KHÔNG thành `false`**: chưa có `ai_config`, gửi `{faceRecognition:true}` → chỉ `face_recognition:true`, KHÔNG có `plate_recognition`/`people_counting`.
- **Lần PATCH đầu** (metadata null) → tạo `ai_config` mới.
- **KHÔNG đụng khoá khác**: `metadata_json={rtsp_config:{...}, face_server_config:{...}}` → sau PATCH 2 khoá đó nguyên vẹn, chỉ thêm `ai_config`.
- **⭐ No-op body rỗng** (`{}`): assert **`save` KHÔNG gọi, `logConfigureAi` KHÔNG gọi, `createQueryRunner` KHÔNG gọi, `configured_at` KHÔNG đổi**; trả device nguyên trạng.
- **⭐ No-op cờ trùng**: `ai_config={face_recognition:true}`, gửi `{faceRecognition:true}` → no-op (0 save/audit/transaction).
- **Đổi thật → transaction**: gửi cờ đổi giá trị → `save`+`logConfigureAi`+`commit` gọi, `configured_at` mới.
- **Device type ngoài allowlist** (`MICROPHONE`) → 409, KHÔNG save.
- **Device không tồn tại** → 404.
- **`finally release()`**: nhánh thành công + nhánh save ném (rollback + release).
- **AC**: các case; **2 case no-op (rỗng + trùng) assert 0 save/audit/transaction** bắt buộc; coverage phần mới ≥80%.

## T5 — Controller route (code) — plan §6, SEC-02
File **Modified**: `src/modules/iot/controllers/iot-devices.controller.ts` — thêm import `ConfigureAiConfigDto`, thêm 1 route (khai cạnh `:id/rtsp-config`):
- `@Patch(':id/ai-config')` · `@UseGuards(JwtAuthGuard, PermissionsGuard)` · `@RequirePermissions('iot.device.configure_ai')` · `@UsePipes(new ValidationPipe({whitelist:true, forbidNonWhitelisted:false, transform:true}))` · lấy `userId` theo style file (`@Req() req` như `configureRtsp`, HOẶC `@CurrentUser` nếu file dùng — T0 chốt) · `@Param('id', ParseUUIDPipe)` · `@Body() ConfigureAiConfigDto` → `{ success:true, message:'AI configuration updated successfully', data: toIotDeviceResponse(device) }`.
- **KHÔNG** đụng route cũ; `:id/ai-config` không xung đột (segment sau literal khác).
- ⚠ Thiếu `@RequirePermissions` = endpoint hở im lặng.
- **AC**: 1 route mới đúng guard + `iot.device.configure_ai` + pipe + DTO + mapper; route cũ không đổi.

## T5b — Test controller — plan §8
Thêm vào `iot-devices.controller.spec.ts`:
- route gọi `service.configureAiConfig(userId, id, dto)`; envelope + `toIotDeviceResponse`.
- Metadata `PERMISSIONS_KEY` = `['iot.device.configure_ai']`; guard `JwtAuthGuard`+`PermissionsGuard`.
- **Không hồi quy**: test route `rtsp-config`/`assign-room`/... cũ vẫn xanh.
- **AC**: case route + metadata permission + không hồi quy.

## T6 — Migration seed permission (code) — plan §7, OQ-8, SEC-02
- File: **`src/database/migrations/20260722000009-SeedIotConfigureAiPermission.ts`** (timestamp chốt T0), class `SeedIotConfigureAiPermission20260722000009` + field `name` trùng class.
- **Đặt trong `migrations/`, KHÔNG `src/database/seeds/`.**
- Mirror [20260722000007](../../../../src/database/migrations/20260722000007-SeedGateLogReadPermission.ts):
  - `permission = { code:'iot.device.configure_ai', name:<ASCII không dấu>, module:'iot', action:'configure_ai', description:<ASCII không dấu> }`; INSERT **6 cột**, `action_code='configure_ai'` **tường minh**.
  - ⚠ **`roles` đúng 1 phần tử**: `['SYSTEM_ADMIN']` (OQ-8 — nhất quán `iot_devices:configure_rtsp`). **KHÁC CẢ BA tiền lệ gần đây**: `zones.gate_log.read` **3 role**, `zones.zone.read` **4 role**, `anpr.vehicle.admin_read`/thao tác ghi zone **2 role**. UC-96 chỉ **1 role**. **CẤM copy nhầm** mảng 2/3/4 phần tử. **CẤM** `ADMIN`/`INTERNAL_USER` (mã lỗi thời → im lặng không insert).
  - `up()` idempotent: INSERT `ON CONFLICT (permission_code) DO NOTHING RETURNING id` → fallback `SELECT id` → return nếu vẫn không có → vòng lặp `role_permissions` `ON CONFLICT DO NOTHING`.
  - `down()`: xoá `role_permissions` **trước**, rồi `permissions`.
- Chỉ tạo file, **KHÔNG chạy** `migration:run`.
- **AC**: đúng tên/vị trí; `permission_code='iot.device.configure_ai'`, `module_code='iot'`, `action_code='configure_ai'`; **đúng 1 role `SYSTEM_ADMIN`** (không 2/3/4); `up()` chạy lại không lỗi/không nhân bản; `down()` đúng thứ tự.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- `npm run build` = **0 error**.
- eslint **chỉ file đã chạm** = **0 rule mới** (**KHÔNG `npm run lint` trần**). ⚠ `iot-devices.service.ts` có **83 lỗi lint pre-existing** — chứng minh bằng `git show HEAD:src/modules/iot/services/iot-devices.service.ts | npx eslint --stdin`, đối chiếu số lỗi; **KHÔNG `--fix`** file đó (chỉ thêm method, không đụng phần cũ).
- `npx jest src/modules/iot` **xanh** — **172 test cũ không hồi quy**, đối chiếu baseline T0. Test cũ fail → **DỪNG, báo cáo, KHÔNG sửa test cho qua**.
- Coverage phần mới (`configureAiConfig` + `logConfigureAi`) **≥80%**.
- **DI-proof**: `AppModule` compile **preview mode** — 0 `UnknownDependenciesException`, 0 circular. Throwaway xoá sạch.
- **KHÔNG** `migration:run` (kể cả local) · **KHÔNG** RDS · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + jest (tách cũ/mới) + coverage + DI-proof.
- **Bàn giao**: gọi `PATCH /iot-devices/:id/ai-config` local cần seed `20260722000009` trước; thiếu → **403** (không phải lỗi code). Config **chỉ ghi DB**, không đẩy xuống camera.
- **Owed**: **consumer phát-hiện-lệch cấu hình chưa làm** (cùng UC-105) — `ai_config` hiện **chỉ ghi, chưa ai đọc** · `configureFaceServer` code chết có spec riêng nhưng không route (UC người khác dở) · module `iot` còn 2 quy ước permission · `iot-devices.service.ts` 83 lỗi lint nền · test đỏ toàn repo ở `auth`/`meetings`/`scheduling` (không thuộc UC-96) · ánh xạ số hiệu UC · Project Overview FE-18 · global exception filter · Swagger · 5 file `spec/global/` rỗng.
- **AC**: bảng gate + tick: constant 5 loại =UC-94 ✓ · DTO 3 cờ + JSDoc 3 mục ✓ · audit `logConfigureAi` chỉ 3 cờ+deviceId ✓ · service MERGE + **no-op giá trị (0 save/audit/transaction)** ✓ · KHÔNG đụng khoá khác metadata_json ✓ · `finally release()` ✓ · route permission gate ✓ · migration **1 role SYSTEM_ADMIN** ✓ · 0 migration schema ✓ · 0 dùng config lọc event ✓ · 172 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-96
- **T0** → baseline 172 · enum 5 loại · configureRtsp pattern · logConfigureRtsp chữ ký · toIotDeviceResponse mask · route order · permission dạng · timestamp `...0009` · mẫu seed
- **T1/T1b** → `AI_CONFIGURABLE_DEVICE_TYPES` 5 loại (=UC-94)
- **T2/T2b** → DTO 3 cờ boolean + JSDoc 3 mục (map event / merge / absent≠false) + whitelist
- **T3/T3b** → `logConfigureAi` (action_type configure_ai, chỉ 3 cờ+deviceId)
- **T4/T4b** → `configureAiConfig` MERGE + **no-op giá trị thật** (0 save/audit/transaction) + KHÔNG đụng khoá khác
- **T5/T5b** → route `PATCH :id/ai-config`, permission gate + metadata test
- **T6** → migration seed `iot.device.configure_ai` → **1 role SYSTEM_ADMIN** (khác 2/3/4 của tiền lệ)
- **T-GATE** → gate + 172 không hồi quy + DI-proof + 83 lỗi lint nền + STOP + bàn giao + Owed
