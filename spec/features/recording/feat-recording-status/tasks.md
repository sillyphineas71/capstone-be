# Tasks: Recording Status & Crash Recovery (REC-004)

- **Feature ID**: REC-004 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> (A) status read-only. (B) reconcile boot OnApplicationBootstrap. Refactor finalizeFileToStopped dùng chung REC-003. SINGLE-INSTANCE. KHÔNG migration. Test MOCK.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md REC-004 (D-1..5: hybrid reconcile, boot-only, perm video.status, :sessionId, refactor finalize). | Toàn bộ file |

---

## 1. Refactor finalizeFileToStopped
**File**: `recording/services/recording-session.service.ts` (sửa)
- [ ] Tách `finalizeFileToStopped({sessionId,meetingId,storagePath,startedAt,paused,userId,baseMetadata,recovered?})` (public): size+sha256+duration + transaction INSERT media_files + UPDATE stopped (+metadata recovered). Ném 500 RECORDING_STOP_FAILED nếu lỗi.
- [ ] `stopVideo` nhánh-file gọi helper; #24 test KHÔNG hồi quy. **Ref**: D-5.

## 2. Phần A — getStatus + controller
**File**: `recording/services/recording-session.service.ts` + `controllers/recording-session.controller.ts` (sửa)
- [ ] `getStatus(meetingId,sessionId)`: 404 (thiếu/meeting mismatch); live→duration wall-clock + fs.stat size (else DB); hasProcessHandle; READ-ONLY.
- [ ] `@Get('live-meetings/:meetingId/recording/:sessionId/status')` `@HttpCode(200)` + guard mock + `@Permissions('recording.video.status')` + 2 ParseUUIDPipe. **Ref**: FR-001..005, D-3/D-4.

## 3. Phần B — reconcile
**File**: `recording/services/recording-reconcile.service.ts` (mới)
- [ ] `RecordingReconcileService implements OnApplicationBootstrap` (inject DataSource + RecordingProcessManager + RecordingSessionService).
- [ ] query orphans (status IN starting,recording,paused & stopped_at IS NULL); skip has; file hợp lệ→finalize(recovered:true); else→markFailed(interrupted by restart). Mỗi session try/catch; query/boot không throw. Log tổng. Comment SINGLE-INSTANCE. **Ref**: FR-006..010, NFR-001/002/007.
- [ ] `recording.module.ts`: +RecordingReconcileService provider.

## 4. Seed
- [ ] `20260615000008-SeedRecordingVideoStatusPermission.ts`: `recording.video.status` ADMIN/MANAGER.

## 5. Tests (mock, ≥80%)
**File**: `recording/services/recording-session.service.spec.ts` (+) + `recording-reconcile.service.spec.ts` (mới)
- [ ] getStatus: live (size+wall-clock) / stopped (DB) / 404 (thiếu + meeting mismatch).
- [ ] reconcile: recover→stopped (finalize gọi) / recover→failed (UPDATE failed, không media_files) / skip has=true / boot-safe (1 throw không reject) / idempotent (WHERE stopped_at IS NULL).
- [ ] #24 stopVideo vẫn xanh sau refactor.

## 6. Verify
- [ ] build · lint per-file · jest modules/recording + coverage · boot smoke (route status GET mapped + reconcile log + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
