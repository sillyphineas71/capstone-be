---
name: feat-recording-status-plan
description: Kế hoạch hiện thực REC-004 — status endpoint (read) + crash recovery reconcile (boot) + refactor finalizeFileToStopped.
category: recording
---

# Implementation Plan: Recording Status & Crash Recovery (REC-004)

- **Feature ID**: REC-004 · **Module**: recording · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md REC-004: (A) getStatus + GET endpoint; (B) RecordingReconcileService OnApplicationBootstrap; refactor finalizeFileToStopped dùng chung; seed video.status. D-1..5 chốt. | Toàn bộ file |

---

## 1. Technical Context (đã xác minh — RECON spec §2)
- Contract KHÔNG có status endpoint → Phần A là backend bổ sung (CLAUDE §22.11). `:sessionId` trong path (D-4).
- `OnApplicationBootstrap` chưa dùng trong repo (chỉ OnModuleInit ở storage/mail) → reconcile boot dùng hook này.
- `RecordingProcessManager.has(id)` đọc Map in-memory → mất khi restart ⇒ phát hiện zombie.
- REC-003 `stopVideo` đã có finalize → tách `finalizeFileToStopped` dùng chung (D-5).
- DATA-01: KHÔNG migration; cột recording_sessions/media_files có sẵn. Single-instance (NFR-001).

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Sửa (refactor) | `recording/services/recording-session.service.ts` (+`finalizeFileToStopped` public, +`getStatus`; stopVideo nhánh file gọi helper) |
| Mới | `recording/services/recording-reconcile.service.ts` (OnApplicationBootstrap) |
| Sửa | `recording/controllers/recording-session.controller.ts` (+GET status) |
| Sửa | `recording/recording.module.ts` (+RecordingReconcileService provider) |
| Mới (seed) | `database/seeds/20260615000008-SeedRecordingVideoStatusPermission.ts` |
| Sửa (test) | `recording/services/recording-session.service.spec.ts` (+getStatus; #24 vẫn xanh) |
| Mới (test) | `recording/services/recording-reconcile.service.spec.ts` |

## 3. Refactor — finalizeFileToStopped (public)
```text
finalizeFileToStopped({ sessionId, meetingId, storagePath, startedAt, paused, userId, baseMetadata, recovered? })
  → { stoppedAt, durationSeconds, fileSizeBytes, mediaFileId }
- stoppedAt=now; duration=max(0, floor((now-started)/1000)-paused).
- fileSizeBytes=String(fs.statSync(path).size); checksum=sha256Stream(path).
- metadata = recovered ? {...baseMetadata, recovered:true} : baseMetadata.
- TRANSACTION: INSERT media_files (video/mp4/local + links/size/checksum/duration) RETURNING id;
  UPDATE recording_sessions stopped (size/duration/checksum/metadata). commit; lỗi→rollback→throw 500 RECORDING_STOP_FAILED.
- stopVideo nhánh-file gọi helper (baseMetadata=metadata có orphan_stop). #24 test KHÔNG hồi quy.
```

## 4. Phần A — getStatus + controller
```text
getStatus(meetingId, sessionId):
- SELECT id, meeting_id, session_type, status, started_at, stopped_at, paused_duration_seconds,
  storage_path, file_size_bytes, duration_seconds FROM recording_sessions WHERE id=$1.
- !row || meeting_id != meetingId → 404 RECORDING_SESSION_NOT_FOUND.
- live = status===recording && stopped_at==null.
  live → durationSeconds=max(0,floor((Date.now()-started)/1000)-paused);
         fileSizeBytes = existsSync(path)? String(statSync.size) : null.
  else → durationSeconds=duration_seconds; fileSizeBytes=file_size_bytes (DB).
- hasProcessHandle=processManager.has(sessionId). READ-ONLY.
controller: @Get('live-meetings/:meetingId/recording/:sessionId/status') @HttpCode(200)
  + guard mock + @Permissions('recording.video.status') + 2 ParseUUIDPipe.
```

## 5. Phần B — RecordingReconcileService (OnApplicationBootstrap)
```text
onApplicationBootstrap():
- try SELECT orphans: status IN (starting,recording,paused) & stopped_at IS NULL; catch→log+return (không chặn boot).
- for each: try {
    if manager.has(id) → skipped++; continue;
    exists = storage_path && existsSync; size = exists? statSync.size : 0;
    if exists && size>0 → sessionService.finalizeFileToStopped({userId:null, recovered:true}) → recovered++;
    else → markFailed(s) (UPDATE status=failed, stopped_at=now, error_message='interrupted by restart', metadata recovered) → failed++;
  } catch(log) // không throw — boot-safe
- log tổng nếu orphans>0.
- Comment SINGLE-INSTANCE rõ.
module: thêm RecordingReconcileService vào providers (inject DataSource + manager + sessionService).
```

## 6. Seed
`20260615000008-SeedRecordingVideoStatusPermission.ts`: `recording.video.status` (module recording, action video_status) ADMIN/MANAGER.

## 7. Tests (mock, ≥80%)
- service.spec (+getStatus): live (fs mock size + wall-clock) / stopped (DB values) / 404 (thiếu + meeting mismatch). #24 stopVideo vẫn xanh sau refactor.
- reconcile.spec (mới): recover→stopped (file size>0 → finalize gọi); recover→failed (file thiếu/0 → markFailed UPDATE, không media_files); skip khi manager.has=true; boot-safe (1 session throw → vẫn chạy session khác, promise không reject); idempotent (assert WHERE chứa stopped_at IS NULL).

## 8. [NEEDS CLARIFICATION]
- Không còn (D-1..5 chốt). Kế thừa: seed-runner chưa wire; PermissionsGuard mock; single-instance (NFR-001).

## 9. DoD
```
[ ] finalizeFileToStopped tách + stopVideo dùng lại (#24 không hồi quy)
[ ] getStatus read-only (live duration/size; stopped DB; 404) + GET endpoint @Permissions video.status
[ ] RecordingReconcileService OnApplicationBootstrap (hybrid recover/failed; skip has; boot-safe; idempotent)
[ ] module provider; seed recording.video.status
[ ] tests getStatus + reconcile + #24 xanh; coverage ≥80%
[ ] build/lint/jest/coverage/boot (route status GET + reconcile log, 0 DI) xanh
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
