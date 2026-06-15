# Tasks: Dừng ghi hình từ IP Camera (REC-003)

- **Feature ID**: REC-003 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> Graceful stop (stdin 'q' → kill). Transaction media_files + session stopped. sha256 STREAMING. KHÔNG migration. Test MOCK (không ffmpeg/fs thật).

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md REC-003 (D-1..7: contract route + verify meeting_id, 'q'/kill 3000ms, wall-clock, sha256 stream, sync 200, no audit). | Toàn bộ file |

---

## 1. RecordingProcessManager.stop
**File**: `recording/services/recording-process-manager.ts` (sửa)
- [ ] `static STOP_TIMEOUT_MS = 3000`.
- [ ] `stop(sessionId, timeoutMs=3000): Promise<'exited'|'killed'|'orphan'>`: !entry→'orphan'; markStopping; nếu proc.exitCode!=null→dọn Map+'exited'; ghi `stdin.write('q')`; race once('exit')→'exited' / timeout→kill('SIGKILL')→exit→'killed'; finally Map.delete + clearTimeout. KHÔNG treo. **Ref**: FR-004/005, NFR-006.

## 2. Service.stopVideo + sha256Stream
**File**: `recording/services/recording-session.service.ts` (sửa)
- [ ] `stopVideo(meetingId, sessionId, userId)`: load session (404 RECORDING_SESSION_NOT_FOUND; meeting mismatch→404); status ∉ {starting,recording,paused}→409 RECORDING_NOT_ACTIVE.
- [ ] stop: `manager.has? manager.stop() : 'orphan'`.
- [ ] file: existsSync + statSync.size; thiếu/0 → session stopped + error_message='empty file', mediaFileId=null (KHÔNG media_files).
- [ ] có file: checksum=`sha256Stream(path)`; duration=max(0, floor((now-startedAt)/1000)-(paused||0)).
- [ ] TRANSACTION (QueryRunner): INSERT media_files (video/mp4/local + size/checksum/duration/links) RETURNING id; UPDATE session stopped (+orphan_stop metadata); commit; lỗi→rollback→500 RECORDING_STOP_FAILED.
- [ ] `private sha256Stream(path): Promise<string>` createReadStream→createHash('sha256')→hex. KHÔNG log url/cred. **Ref**: FR-006..010, NFR-001/003/008.

## 3. Controller
**File**: `recording/controllers/recording-session.controller.ts` (sửa)
- [ ] `@Post('live-meetings/:meetingId/recording/:sessionId/stop-video')` `@HttpCode(200)` + guard mock + `@Permissions('recording.video.stop')` + 2 ParseUUIDPipe; không body; userId từ req.user. **Ref**: FR-001, D-1/D-5.

## 4. Module + Seed
- [ ] `recording.module.ts`: xác nhận `MediaFileEntity` đã trong forFeature (REC-001) — không đổi.
- [ ] seed `20260615000007-SeedRecordingVideoStopPermission.ts`: `recording.video.stop` ADMIN/MANAGER.

## 5. Tests (mock, ≥80%)
**File**: `recording/services/recording-process-manager.spec.ts` + `recording-session.service.spec.ts` (sửa)
- [ ] manager.stop: exited / timeout→killed / orphan; Map dọn.
- [ ] service.stopVideo: happy 200 + INSERT media_files + UPDATE stopped; 404 session; 404 meeting mismatch; 409 not-active; orphan→stopped finalize; empty file→stopped no media_files mediaFileId null; rollback INSERT throw→500.

## 6. Verify
- [ ] build · lint per-file · jest modules/recording + coverage · boot smoke (route stop-video mapped + started + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
