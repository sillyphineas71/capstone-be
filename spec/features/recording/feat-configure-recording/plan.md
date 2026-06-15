---
name: feat-configure-recording-plan
description: Kế hoạch hiện thực REC-001 — CRUD recording-config meeting-scoped trên bảng recording_configs có sẵn.
category: recording
---

# Implementation Plan: Cấu hình ghi âm/ghi hình (REC-001)

- **Feature ID**: REC-001
- **Module**: `recording`
- **Spec Reference**: [spec.md](./spec.md)
- **Status**: Draft

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md REC-001: controller/service/dto/audit-repo trong module recording, tái dùng entity recording_configs. Xác minh AppModule đã import RecordingModule; JwtAuthGuard wire qua AuthModule+JwtModule+CacheModule. | Toàn bộ file |

---

## 1. Technical Context (đã xác minh)

- [recording-config.entity.ts](../../../../src/modules/recording/entities/recording-config.entity.ts): `RecordingConfigEntity` (meeting_id NOT NULL, video_source_device_id nullable, configured_by, configured_at default now(), status default 'draft'). `AudioSourceMode` enum, `RecordingConfigStatus` enum.
- [recording.module.ts](../../../../src/modules/recording/recording.module.ts): chỉ `TypeOrmModule.forFeature([4 entity])` — chưa có controller/service. **AppModule đã import RecordingModule** (app.module.ts:100) → thêm controller là route tự đăng ký, KHÔNG sửa AppModule.
- `JwtAuthGuard` cần `JwtService/AuthConfigService/RedisService/Reflector` → mirror iot.module: import `AuthModule, JwtModule.register({}), CacheModule.register()`. (AuthModule không circular với recording.)
- audit_logs cols: `(user_id, action_type, entity_type, entity_id, severity, metadata_json)` — mirror `IotAuditRepository` (raw insert).
- meetings table `meetings`; iot_devices có `device_type`; recording_sessions có `meeting_id/status/stopped_at`.
- DATA-01: KHÔNG tạo bảng/migration/sửa schema. Đọc meeting/device/session qua `dataSource.manager` raw (read-only) — KHÔNG import MeetingsModule/IotModule.

## 2. Danh sách thay đổi (file)

| Loại | File |
|---|---|
| Mới | `dto/create-recording-config.dto.ts`, `dto/update-recording-config.dto.ts`, `dto/recording-config-response.dto.ts` |
| Mới | `repositories/recording-config-audit.repository.ts` |
| Mới | `services/recording-config.service.ts` |
| Mới | `controllers/recording-config.controller.ts` |
| Sửa | `recording.module.ts` (imports AuthModule/JwtModule/CacheModule; controllers; providers) |
| Mới (seed) | `src/database/seeds/20260615000005-SeedRecordingConfigPermissions.ts` |
| Mới (test) | `services/recording-config.service.spec.ts` + `dto/*.spec.ts` |

## 3. DTO
- **CreateRecordingConfigDto** (tất cả optional, default ở service): `enableAudio/enableVideo/enableTranscription/autoStart/consentRequired` `@IsOptional @IsBoolean`; `videoSourceDeviceId?` `@IsOptional @ValidateIf(v!==null) @IsUUID('4')`; `audioSourceMode?` `@IsOptional @IsEnum(AudioSourceMode)`; `retentionDays?` `@IsOptional @IsInt @Min(1) @Max(365)`.
- **UpdateRecordingConfigDto**: y hệt (partial).
- **toRecordingConfigResponse(entity)**: camelCase (id, meetingId, enable*, videoSourceDeviceId, audioSourceMode, autoStart, consentRequired, retentionDays, status, configuredBy, configuredAt).

## 4. Audit repo — `RecordingConfigAuditRepository`
Mirror IotAuditRepository: `logConfigChange(manager, { userId, configId, action: 'create'|'update' })` → INSERT audit_logs (action_type=action, entity_type='recording_configs', entity_id=configId, severity='info', metadata_json=null/changes).

## 5. Service — `RecordingConfigService` (inject DataSource + audit repo)
- `create(meetingId, dto, userId)`:
  1. meeting tồn tại? `manager.query('SELECT id FROM meetings WHERE id=$1', [meetingId])` rỗng → `NotFoundException MEETING_NOT_FOUND`.
  2. config đã có? `manager.findOne(RecordingConfigEntity, { where: { meetingId } })` → có → `ConflictException RECORDING_CONFIG_EXISTS`.
  3. `validateVideoSource(dto.videoSourceDeviceId)` (nếu != null) → không ip_camera → `BadRequestException INVALID_VIDEO_SOURCE_DEVICE`.
  4. transaction: create entity {fields, meetingId, configuredBy:userId, configuredAt:new Date(), status:'draft'} → save → audit 'create' → commit → toResponse (201).
- `findOne(meetingId)`: findOne by meetingId → null → `NotFoundException RECORDING_CONFIG_NOT_FOUND` → toResponse.
- `update(meetingId, dto, userId)`:
  1. findOne → null → 404.
  2. `assertNotRecording(meetingId)`: `manager.query("SELECT id FROM recording_sessions WHERE meeting_id=$1 AND status IN ('starting','recording','paused') AND stopped_at IS NULL LIMIT 1")` → có → `ConflictException RECORDING_IN_PROGRESS`.
  3. validateVideoSource nếu videoSourceDeviceId trong dto != null.
  4. build updates (field !== undefined); idempotent: không đổi thực → return toResponse(existing).
  5. transaction: assign updates + configuredBy:userId + configuredAt:new Date() → save → audit 'update' → commit → toResponse.
- `validateVideoSource(id)`: `manager.query("SELECT id FROM iot_devices WHERE id=$1 AND device_type='ip_camera'")` rỗng → throw 400.

## 6. Controller — `RecordingConfigController`
`@Controller()` route `meetings/:meetingId/recording-config`; `@Post` (201) / `@Get` (200) / `@Patch` (200); `@UseGuards(JwtAuthGuard, MockPermissionsGuard)` + `@Permissions('recording.config.create'|'read'|'update')`; `@Param('meetingId', ParseUUIDPipe)`; POST/PATCH `@UsePipes(ValidationPipe whitelist+forbidNonWhitelisted+transform)`; userId từ JWT. Mock guard/Permissions decorator như iot controller.

## 7. Module wiring
`recording.module.ts`: `imports: [TypeOrmModule.forFeature([...]), AuthModule, JwtModule.register({}), CacheModule.register()]`, `controllers: [RecordingConfigController]`, `providers: [RecordingConfigService, RecordingConfigAuditRepository]`.

## 8. Seed
`20260615000005-SeedRecordingConfigPermissions.ts`: 3 permission `recording.config.create/read/update` (module 'recording'), gán ADMIN/MANAGER.

## 9. Error map
400 VALIDATION_ERROR / INVALID_VIDEO_SOURCE_DEVICE · 401 · 403 · 404 MEETING_NOT_FOUND / RECORDING_CONFIG_NOT_FOUND · 409 RECORDING_CONFIG_EXISTS / RECORDING_IN_PROGRESS · 500.

## 10. Tests (≥80% code mới)
Service (mock dataSource.manager + queryRunner + audit): create happy/404 meeting/409 exists/invalid-device-400; findOne happy/404; update partial/404/409-session(mock query trả row)/idempotent/bump configured_*. DTO validate (retention>365→400, enum sai, uuid sai, field lạ). Không e2e (boot smoke-test riêng).

## 11. [NEEDS CLARIFICATION]
- **[NC-P1]** Seed-runner chưa wire (team-wide, như IOT-*).
- **[NC-P2]** PermissionsGuard mock (như IOT-*) — enforce 403 runtime task team-wide.

## 12. DoD
```
[ ] 3 DTO + response mapper camelCase
[ ] RecordingConfigAuditRepository (audit_logs recording_configs)
[ ] service create/findOne/update (404/409/idempotent/validate device/bump configured_*)
[ ] controller 3 route + guard mock + ParseUUIDPipe + ValidationPipe
[ ] recording.module wiring (AuthModule+Jwt+Cache, controller, providers)
[ ] seed recording.config.* (ADMIN/MANAGER)
[ ] tests ≥80% code mới
[ ] build/lint(per-file)/test xanh; boot smoke-test route mapped
```

> Trạng thái: **CHỜ REVIEW**. tasks.md đã tạo. Chưa commit.
