---
name: feat-start-recording-plan
description: Kế hoạch hiện thực REC-002 — start-video qua ffmpeg spawn + RecordingProcessManager + recording_session.
category: recording
---

# Implementation Plan: Bắt đầu ghi hình từ IP Camera (REC-002)

- **Feature ID**: REC-002 · **Module**: recording (+ common/config) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo plan.md REC-002 (ffmpeg util, RecordingProcessManager, RecordingSessionService.startVideo, ENV, seed, test mock spawn). | Toàn bộ file |
| 2026-06-15 | Fix buildFfmpegArgs → VIDEO-ONLY (`-map 0:v:0`): camera RTSP thật kèm audio pcm_alaw không tương thích mp4 khi `-c copy`; ghi kèm audio (transcode aac) ngoài scope #23b. | buildFfmpegArgs |

---

## 1. Technical Context (đã xác minh)
- `recording_sessions` entity đủ cột (status enum, storage_path, started_by, metadata_json) — DATA-01 không migration.
- StorageService chỉ buffer → ffmpeg ghi thẳng `RECORDING_STORAGE_PATH` (tự mkdir).
- `child_process` chưa dùng → spawn mới. Provider Nest singleton → manager giữ Map.
- decryptSecret (IOT-015) consumer; rtsp_config keys đã biết.
- recording.module đã có (REC-001) import AuthModule+Jwt+Cache + DataSource khả dụng → thêm controller/providers.
- live-meeting module rỗng (không đụng). Route `live-meetings/...` khai trong controller recording.
- env.validation section "Q" có RTSP_CRED_KEY → thêm FFMPEG_PATH + RECORDING_STORAGE_PATH.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `recording/utils/ffmpeg.util.ts` (buildArgs, spawnFfmpeg, redactUrl) |
| Mới | `recording/services/recording-process-manager.ts` (singleton) |
| Mới | `recording/services/recording-session.service.ts` (startVideo) |
| Mới | `recording/controllers/recording-session.controller.ts` |
| Mới | `recording/dto/start-video.dto.ts` |
| Sửa | `recording/recording.module.ts` (controller + providers) |
| Sửa | `config/env.validation.ts` (+FFMPEG_PATH +RECORDING_STORAGE_PATH) + `.env.example` + `.env` local (RECORDING_STORAGE_PATH) |
| Mới (seed) | `database/seeds/20260615000006-SeedRecordingVideoStartPermission.ts` |
| Mới (test) | `recording/utils/ffmpeg.util.spec.ts` + `recording/services/recording-session.service.spec.ts` |

## 3. ffmpeg.util.ts
```ts
import { spawn, ChildProcess } from 'child_process';
export function buildFfmpegArgs(url: string, outPath: string): string[] {
  // VIDEO-ONLY: -map 0:v:0 loại audio pcm_alaw không tương thích mp4 khi -c copy
  return ['-rtsp_transport','tcp','-i',url,'-map','0:v:0','-c','copy',
          '-movflags','+frag_keyframe+empty_moov','-f','mp4',outPath];
}
export function redactUrl(s: string): string {
  return s.replace(/\/\/[^@/]+@/g, '//***@'); // ẩn user:pass@
}
export function spawnFfmpeg(url: string, outPath: string): ChildProcess {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  return spawn(bin, buildFfmpegArgs(url, outPath), { windowsHide: true });
}
```
- KHÔNG log url/args. Mọi log lỗi đi qua redactUrl. (Test inject spawn qua mock child_process.)

## 4. RecordingProcessManager (singleton, inject DataSource)
```text
- procs: Map<sessionId, { proc: ChildProcess; stopping: boolean }>
- stderrTail: giữ ≤20 dòng cuối (redact) / process.
- start(sessionId, url, outPath): proc=spawnFfmpeg; procs.set; gắn:
    proc.stderr.on('data') → push tail (redactUrl).
    proc.on('error', err) → handleUnexpectedExit(sessionId, redact(err.message)).
    proc.on('exit', code) → nếu !stopping → handleUnexpectedExit(sessionId, `exit ${code}: ${tail}`).
  return proc.
- waitForGrace(sessionId, ms=2000): Promise<'alive'|'dead'>
    race: timeout(ms)→'alive' ; proc 'exit'/'error'→'dead'. (dùng để service quyết định 201 vs fail)
- markStopping(sessionId) cho #24.
- handleUnexpectedExit: try { update recording_sessions set status='failed', error_message=<redacted>, stopped_at=now where id } catch(log) ; procs.delete.
- has/get(sessionId).
```

## 5. RecordingSessionService.startVideo(meetingId, dto, userId)
```text
1. meeting tồn tại? raw query → 404 MEETING_NOT_FOUND.
2. device = manager.findOne(iot_devices, body.cameraDeviceId); null→404 IOT_DEVICE_NOT_FOUND; deviceType!=ip_camera→400 INVALID_VIDEO_SOURCE_DEVICE.
3. cfg = device.metadataJson?.rtsp_config; thiếu cfg||host||path → 400 RTSP_NOT_CONFIGURED.
4. active session? raw query recording_sessions status in(starting,recording,paused) & stopped_at null & meeting_id → 409 RECORDING_ALREADY_ACTIVE.
5. password: nếu cfg.rtsp_password_encrypted → try decryptSecret catch → throw 500 (generic, không lộ).
6. url = rtsp://[user[:pass]@]host:port/path (in-memory). (link recording_config best-effort: query recording_configs by meeting → recordingConfigId nếu có.)
7. id = randomUUID(); outPath = join(RECORDING_STORAGE_PATH, `${id}.mp4`); mkdir recursive RECORDING_STORAGE_PATH.
8. save recording_session { id, meetingId, deviceId, recordingConfigId?, sessionType:video, sourceType:ip_camera, status:recording, startedBy:userId, startedAt:now, storageProvider:'local', storagePath:outPath }.
9. manager.start(id, url, outPath); grace = await manager.waitForGrace(id, 2000).
   if grace==='dead': (manager đã/đang markFailed) → throw 500 RECORDING_START_FAILED.
   else → return { recordingSessionId:id, sessionType:'video', status:'recording', startedAt, cameraDeviceId }.
```
- decryptSecret import từ common (IOT-015). KHÔNG log url/password.
- inject ConfigService (RECORDING_STORAGE_PATH) + DataSource + manager.

## 6. Controller
`@Controller()` + `@Post('live-meetings/:meetingId/recording/start-video')` `@HttpCode(201)` + guard mock + `@Permissions('recording.video.start')` + `@Param('meetingId',ParseUUIDPipe)` + `@UsePipes(ValidationPipe{whitelist:true,transform:true})` (KHÔNG forbidNonWhitelisted — cho phép outputFormat/storageProvider thừa, strip). DTO StartVideoDto { cameraDeviceId @IsUUID; outputFormat?/storageProvider? @IsOptional@IsString (bỏ qua) }.

## 7. Module wiring
recording.module: `controllers: [RecordingConfigController, RecordingSessionController]`, `providers: [...REC-001, RecordingSessionService, RecordingProcessManager]`. (AuthModule/Jwt/Cache đã import.)

## 8. ENV
Joi section Q thêm: `FFMPEG_PATH: Joi.string().default('ffmpeg')`, `RECORDING_STORAGE_PATH: Joi.string().default('./storage/recordings')`. `.env.example` + `.env` local (RECORDING_STORAGE_PATH; FFMPEG_PATH đã có).

## 9. Seed
`recording.video.start` (module 'recording', action 'video_start'), ADMIN/MANAGER.

## 10. Tests (≥80%, MOCK child_process.spawn — KHÔNG ffmpeg thật)
- `ffmpeg.util.spec`: buildFfmpegArgs đúng thứ tự; redactUrl ẩn user:pass@.
- `recording-session.service.spec`: mock `spawnFfmpeg`/manager. happy→201 recording + session saved; 404 meeting; 400 not-ip_camera; 400 RTSP_NOT_CONFIGURED; 409 active; ffmpeg chết trong grace (mock waitForGrace→'dead')→500 RECORDING_START_FAILED; assert URL/password KHÔNG trong response/DB record/log.
- Manager: mock fake ChildProcess (EventEmitter) → exit→markFailed update gọi; redact stderr.

## 11. [NEEDS CLARIFICATION]
- Không còn (NC-1..5 chốt). Kế thừa team-wide: seed-runner, PermissionsGuard mock.

## 12. DoD
```
[ ] ffmpeg.util (buildArgs/redactUrl/spawn, không log)
[ ] RecordingProcessManager (Map, exit/error→failed redacted, waitForGrace, has/get)
[ ] RecordingSessionService.startVideo (404/400/409/decrypt/spawn/grace→201|500)
[ ] controller start-video @HttpCode201 + guard + ParseUUID + ValidationPipe
[ ] module wiring; ENV FFMPEG_PATH/RECORDING_STORAGE_PATH; seed recording.video.start
[ ] tests mock spawn ≥80%; SEC-01 assert no password/url leak
[ ] build/lint/test/boot xanh (route mapped)
```

> Trạng thái: CHỜ REVIEW. tasks.md đã tạo. Chưa commit.
