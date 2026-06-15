# Tasks: Bắt đầu ghi hình từ IP Camera (REC-002)

- **Feature ID**: REC-002 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> ffmpeg spawn + process manager. KHÔNG log url/args/password. KHÔNG migration. Test MOCK spawn (không chạy ffmpeg thật).

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks.md REC-002 (NC-1..5 chốt: body camera, grace 2s, ép mp4/local, controller recording, 201). | Toàn bộ file |

---

## 1. ffmpeg util
**File**: `recording/utils/ffmpeg.util.ts` (mới)
- [ ] `buildFfmpegArgs(url,outPath)`; `redactUrl(s)` ẩn `//user:pass@`; `spawnFfmpeg(url,outPath)` spawn FFMPEG_PATH `{windowsHide:true}`.
- [ ] KHÔNG log url/args. **Ref**: FR-008, NFR-001.

## 2. RecordingProcessManager
**File**: `recording/services/recording-process-manager.ts` (mới, singleton, inject DataSource)
- [ ] `start(sessionId,url,outPath)`: spawn + Map.set + handlers error/exit + stderr tail (redact ≤20 dòng).
- [ ] `waitForGrace(sessionId,ms=2000)`: race timeout→'alive' / exit-error→'dead'.
- [ ] unexpected exit/error → `markFailed` (update status=failed + error_message redacted) trong try/catch + Map.delete.
- [ ] `has/get/markStopping` (cho #24). **Ref**: FR-009, NFR-003.

## 3. Service
**File**: `recording/services/recording-session.service.ts` (mới, inject DataSource + ConfigService + manager)
- [ ] `startVideo(meetingId,dto,userId)`: 404 meeting / 404 device / 400 not-ip_camera / 400 RTSP_NOT_CONFIGURED / 409 active / decrypt (catch→500 generic) / build url in-memory / mkdir / tạo session / manager.start + grace → 201 hoặc 500 RECORDING_START_FAILED.
- [ ] KHÔNG log url/password. **Ref**: FR-001..010.

## 4. DTO + Controller
**File**: `recording/dto/start-video.dto.ts` + `recording/controllers/recording-session.controller.ts` (mới)
- [ ] DTO: `cameraDeviceId @IsUUID('4')`; `outputFormat?/storageProvider? @IsOptional @IsString` (bỏ qua).
- [ ] `@Post('live-meetings/:meetingId/recording/start-video')` `@HttpCode(201)` + guard mock + `@Permissions('recording.video.start')` + ParseUUIDPipe + ValidationPipe(whitelist+transform, KHÔNG forbidNonWhitelisted). **Ref**: FR-001, NC-3/4/5.

## 5. Module + ENV + Seed
- [ ] `recording.module.ts`: +RecordingSessionController, +RecordingSessionService, +RecordingProcessManager.
- [ ] `env.validation.ts` section Q: `FFMPEG_PATH` default 'ffmpeg', `RECORDING_STORAGE_PATH` default './storage/recordings'. `.env.example` + `.env` local.
- [ ] seed `20260615000006-SeedRecordingVideoStartPermission.ts`: `recording.video.start` ADMIN/MANAGER.

## 6. Tests (mock spawn, ≥80%)
**File**: `recording/utils/ffmpeg.util.spec.ts` + `recording/services/recording-session.service.spec.ts`
- [ ] util: buildArgs đúng; redactUrl ẩn cred.
- [ ] service: happy 201; 404 meeting; 400 not-ip_camera; 400 RTSP_NOT_CONFIGURED; 409 active; ffmpeg chết grace→500 RECORDING_START_FAILED.
- [ ] SEC: URL/password KHÔNG xuất hiện trong response/DB record.

## 7. Verify
- [ ] build · lint per-file · jest (mock spawn) + coverage · boot smoke (route start-video mapped + started + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
