---
name: feat-stop-recording-plan
description: Kế hoạch hiện thực REC-003 — stop-video qua manager.stop (graceful 'q'/kill) + chốt media_files + session stopped.
category: recording
---

# Implementation Plan: Dừng ghi hình từ IP Camera (REC-003)

- **Feature ID**: REC-003 · **Module**: recording (+ common util) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md REC-003 (manager.stop graceful, stopVideo + transaction media_files, sha256 stream, controller stop-video, seed). NC-1..6 đã chốt (D-1..7). | Toàn bộ file |

---

## 1. Technical Context (đã xác minh — RECON spec §2)
- `recording_sessions` + `media_files` entity đủ cột (DATA-01: KHÔNG migration). `file_size_bytes` bigint → string.
- `media_files` NOT NULL: file_name/file_type/mime_type/storage_provider/storage_key. Default version_no/visibility_level/is_active/uploaded_at.
- `RecordingProcessManager` có markStopping/has/get; **thêm `stop()`**. `proc.stdin` sẵn (stdio pipe mặc định). exit-handler đã guard `stopping`.
- ffmpeg `+frag_keyframe+empty_moov` → file phát được kể cả khi kill. `storage_path` không chứa cred → log path an toàn.
- decision D-1..7 chốt: contract route + verify meeting_id; graceful 'q'/kill 3000ms; wall-clock; sha256 stream; sync 200; no audit.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Sửa | `recording/services/recording-process-manager.ts` (+`stop()`, +const STOP_TIMEOUT_MS) |
| Sửa | `recording/services/recording-session.service.ts` (+`stopVideo()`, +`sha256Stream()` private) |
| Sửa | `recording/controllers/recording-session.controller.ts` (+route stop-video) |
| Sửa | `recording/recording.module.ts` (MediaFileEntity đã trong forFeature — xác nhận, không đổi) |
| Mới (seed) | `database/seeds/20260615000007-SeedRecordingVideoStopPermission.ts` |
| Sửa (test) | `recording/services/recording-process-manager.spec.ts` (+stop cases) |
| Sửa (test) | `recording/services/recording-session.service.spec.ts` (+stopVideo cases) |

## 3. RecordingProcessManager.stop (mới)
```ts
private static readonly STOP_TIMEOUT_MS = 3000;

async stop(sessionId: string, timeoutMs = RecordingProcessManager.STOP_TIMEOUT_MS):
  Promise<'exited' | 'killed' | 'orphan'> {
  const entry = this.procs.get(sessionId);
  if (!entry) return 'orphan';
  this.markStopping(sessionId);              // exit không bị markFailed
  const { proc } = entry;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true;
      clearTimeout(timer); this.procs.delete(sessionId); resolve(r); };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {}
      // đợi exit sau kill; nếu đã exit, 'exit' handler dưới finish('killed')
    }, timeoutMs);
    let killed = false;
    const timer2 = setTimeout(() => { killed = true; }, timeoutMs); // mốc phân biệt
    proc.once('exit', () => finish(killed ? 'killed' : 'exited'));
    try { proc.stdin?.write('q'); } catch { /* fallback: timeout sẽ kill */ }
  });
}
```
- Robust: nếu `proc` đã exit trước (race) → `once('exit')` vẫn fire hoặc proc.exitCode!=null. (Triển khai sẽ kiểm `proc.exitCode!==null` đầu hàm → resolve 'exited' ngay, dọn Map.)
- KHÔNG treo: luôn có timeout → kill → exit. `finally` dọn Map + clearTimeout.

## 4. RecordingSessionService.stopVideo(meetingId, sessionId, userId)
```text
1. load recording_session theo id (raw query). null → 404 RECORDING_SESSION_NOT_FOUND.
   meeting_id !== meetingId → 404 RECORDING_SESSION_NOT_FOUND.
2. status ∉ {starting,recording,paused} → 409 RECORDING_NOT_ACTIVE.
3. stopRes = manager.has(sessionId) ? await manager.stop(sessionId) : 'orphan'.
4. storagePath = session.storage_path. stoppedAt = new Date().
   exists = fs.existsSync(storagePath); size = exists ? fs.statSync(storagePath).size : 0.
5. duration = max(0, floor((stoppedAt - startedAt)/1000) - (paused_duration_seconds||0)).
6a. file thiếu/size 0:
    UPDATE recording_sessions {status:'stopped', stopped_at, stopped_by, duration_seconds:duration,
      error_message:'empty file', metadata_json(+orphan_stop nếu orphan)}.
    return {…, fileSizeBytes:'0', mediaFileId:null}.
6b. có file:
    checksum = await sha256Stream(storagePath).
    QueryRunner transaction:
      INSERT media_files (...) RETURNING id  → mediaFileId.
      UPDATE recording_sessions {status:'stopped', stopped_at, stopped_by, file_size_bytes:String(size),
        duration_seconds, checksum, metadata_json(+orphan_stop)}.
      commit. lỗi → rollback → throw 500 RECORDING_STOP_FAILED (session giữ recording).
    return {recordingSessionId, status:'stopped', stoppedAt, durationSeconds:duration,
      fileSizeBytes:String(size), mediaFileId}.
```
- `sha256Stream(path)`: Promise<string> — createReadStream → hash('sha256') → on('end') resolve hex; on('error') reject.
- media_files INSERT cột snake: file_name, file_type, mime_type, storage_provider, storage_key, recording_session_id, meeting_id, uploaded_by, file_size_bytes, checksum, duration_seconds. (version_no/visibility_level/is_active/uploaded_at để default DB.)
- KHÔNG log storage_path-có-cred (path không cred — OK); KHÔNG log url.

## 5. Controller
`@Post('live-meetings/:meetingId/recording/:sessionId/stop-video')` `@HttpCode(200)` + guard mock + `@Permissions('recording.video.stop')` + 2 `@Param(...,ParseUUIDPipe)` + KHÔNG body. userId từ req.user.

## 6. Module
`recording.module.ts`: `MediaFileEntity` đã trong `TypeOrmModule.forFeature` (REC-001) → INSERT qua manager/queryRunner OK. Không đổi providers/controllers (RecordingSessionController/Service đã đăng ký REC-002).

## 7. Seed
`20260615000007-SeedRecordingVideoStopPermission.ts`: permission `recording.video.stop` (module 'recording', action 'video_stop'), ADMIN/MANAGER. (Mirror seed 06.)

## 8. Tests (≥80% code mới, MOCK — không ffmpeg/fs thật)
- **manager.spec** (+): stop 'exited' (fake exit ngay); stop timeout→'killed' (fake không exit → jest fake timers → kill→exit); stop 'orphan' (has=false). Đảm bảo Map.delete.
- **service.spec** (+): mock `fs.existsSync`/`statSync` + `createReadStream`(hoặc spy `sha256Stream`) + dataSource.createQueryRunner (connect/startTransaction/query/commit/rollback/release).
  - happy → 200 stopped + INSERT media_files gọi + UPDATE session stopped; mediaFileId trả.
  - 404 session không tồn tại; 404 meeting mismatch; 409 not-active.
  - orphan (manager.has=false) → vẫn stopped + finalize (metadata orphan_stop).
  - empty file (existsSync=false hoặc size 0) → stopped, KHÔNG INSERT media_files, mediaFileId=null.
  - rollback: query INSERT throw → rollbackTransaction gọi → 500 RECORDING_STOP_FAILED.

## 9. [NEEDS CLARIFICATION]
- Không còn (D-1..7 chốt). Kế thừa team-wide: seed-runner chưa wire; PermissionsGuard mock.

## 10. DoD
```
[ ] manager.stop (graceful 'q' → exit | timeout kill | orphan; dọn Map; không treo)
[ ] stopVideo (404/404/409; orphan; empty file; transaction media_files+session; rollback→500)
[ ] sha256Stream streaming; duration wall-clock; file_size_bytes string
[ ] controller stop-video @HttpCode200 + guard + 2 ParseUUID; seed recording.video.stop
[ ] tests mock (manager.stop + stopVideo) ≥80%; SEC không log cred
[ ] build/lint/jest/coverage/boot xanh (route stop-video mapped)
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
