# Tasks: Cấu hình ghi âm/ghi hình (REC-001)

- **Feature ID**: REC-001 · **Module**: `recording`
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
- **Status**: Draft (chưa code)

> Tái dùng entity `recording_configs`. KHÔNG tạo bảng/migration/sửa schema. Đọc meeting/device/session qua `dataSource.manager` (read-only, không import MeetingsModule/IotModule). camelCase response.

---

## CHANGELOG & REVISION HISTORY

| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md REC-001 theo plan (NC-2..5 đã chốt). | Toàn bộ file |

---

## 1. DTO
**File**: `dto/create-recording-config.dto.ts`, `dto/update-recording-config.dto.ts`, `dto/recording-config-response.dto.ts` (mới)
- [ ] Create/Update DTO: 8 field allowlist optional; videoSourceDeviceId `@ValidateIf(v!==null)@IsUUID`; audioSourceMode `@IsEnum(AudioSourceMode)`; retentionDays `@IsInt@Min(1)@Max(365)`; enable*/autoStart/consentRequired `@IsBoolean`.
- [ ] `toRecordingConfigResponse(entity)` camelCase.

**DoD**: compile; validate đúng. **Ref**: FR-012/013, EC-003/004.

## 2. Audit repo
**File**: `repositories/recording-config-audit.repository.ts` (mới)
- [ ] `logConfigChange(manager, { userId, configId, action })` INSERT audit_logs (entity_type='recording_configs').

**DoD**: compile. **Ref**: FR-017/018.

## 3. Service
**File**: `services/recording-config.service.ts` (mới, inject DataSource + audit repo)
- [ ] `create`: 404 meeting / 409 exists / validate device 400 / transaction insert+audit / 201.
- [ ] `findOne`: 404 nếu chưa có.
- [ ] `update`: 404 / guard session 409 / validate device / idempotent / bump configured_by+configured_at / transaction.
- [ ] `validateVideoSource`: query iot_devices device_type='ip_camera'.

**DoD**: các nhánh đúng. **Ref**: FR-001..011, AC-001..009.

## 4. Controller
**File**: `controllers/recording-config.controller.ts` (mới)
- [ ] 3 route `meetings/:meetingId/recording-config` (@Post 201/@Get 200/@Patch 200); guard mock + @Permissions; ParseUUIDPipe; ValidationPipe (POST/PATCH).

**DoD**: route đăng ký. **Ref**: FR-001/005/007/014/015.

## 5. Module wiring
**File**: `recording.module.ts` (sửa)
- [ ] imports +AuthModule +JwtModule.register({}) +CacheModule.register(); controllers:[RecordingConfigController]; providers:[RecordingConfigService, RecordingConfigAuditRepository].

**DoD**: build không circular; route mapped khi boot.

## 6. Seed
**File**: `src/database/seeds/20260615000005-SeedRecordingConfigPermissions.ts` (mới)
- [ ] 3 permission recording.config.create/read/update (module 'recording'), gán ADMIN/MANAGER, ON CONFLICT DO NOTHING.

## 7. Tests
**File**: `services/recording-config.service.spec.ts` (mới) + dto spec
- [ ] create: happy/404 meeting/409 exists/invalid-device-400.
- [ ] findOne: happy/404.
- [ ] update: partial/404/409-session/idempotent/bump.
- [ ] DTO: retention>365→invalid, enum sai, uuid sai, field lạ.
- [ ] coverage ≥80% code mới.

## 8. Verify
- [ ] build pass · lint per-file · jest pass · boot smoke (route POST/GET/PATCH mapped + successfully started + 0 DI lỗi).

---

> Trạng thái: CHỜ REVIEW sau implement.
