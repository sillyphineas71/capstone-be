# TASKS — UC-114 (pause) + UC-115 (resume) ghi hình

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới tasks.md CHUNG UC-114+115 (T001–T009). Điều chỉnh: BỎ audit pause/resume; concat → `{sessionId}_final.mp4`. | Toàn bộ file |

> Dựa trên spec.md + plan.md UC-114/115 đã duyệt. CHỈ danh sách task — KHÔNG code.
> ⚠️ **BR-05**: đoạn pause TUYỆT ĐỐI không có process ffmpeg ghi. Cơ chế SEGMENT.
> ⚠️ **BR-06**: luồng cũ start→stop 0-pause hoạt động Y HỆT.

---

## 0. Điều chỉnh so với plan (chốt sau verify src) + C1–C8
- **BỎ audit pause/resume**: start/stop hiện KHÔNG ghi `audit_logs` → pause/resume ghi audit sẽ LỆCH convention recording. Bỏ cho nhất quán.
- **Concat → `{sessionId}_final.mp4`** (KHÔNG ghi thẳng `{sessionId}.mp4` — trùng segment đầu đang là input → đè hỏng). `finalizeFileToStopped(storagePath={sessionId}_final.mp4)`. Verify: `startVideo` tạo `{sessionId}.mp4` (:154); `finalizeFileToStopped` `fileName={sessionId}.mp4` (:914) — media_file `file_name` vẫn `{sessionId}.mp4`, storagePath trỏ file concat.
- C1 reuse `recording.video.stop` (không seed). C2 `metadata_json`(segments[]/paused_at/pause_count). C3 concat→`_final.mp4`. C4 concat OK xóa segment+list; lỗi 500 giữ. C5 resume fail giữ paused+502. C6 reconcile TODO. C7 concat demuxer đã test. C8 pause-video/resume-video.
- resume dựng url: `buildRtspUrl(cfg)` (:1083) với `cfg = device.metadata_json['rtsp_config']` (:112) — lặp truy vấn `iot_devices` như `startVideo` (:88-119).

### Bảo vệ code người khác
- SỬA: `recording-session.service.ts` (+pauseVideo/+resumeVideo/~stopVideo), `recording-session.controller.ts` (+2 handler), `ffmpeg.util.ts` (+concat). Reconcile CHỈ +TODO comment.
- **KHÔNG sửa** `recording-process-manager.ts` (API đủ). KHÔNG đụng `startVideo` guard/no-data probe/`finalizeFileToStopped` signature/`RECORDING_ALREADY_ACTIVE`/media-files/config/audio/transcription.
- Test **file riêng**; test start/stop/status/media/config cũ **vẫn pass**.

---

## T001 — [MODIFY additive] `ffmpeg.util.ts` — concat helper
**File**: `src/modules/recording/utils/ffmpeg.util.ts`
- THÊM `buildConcatArgs(listPath, outPath): string[]` = `['-f','concat','-safe','0','-i',listPath,'-c','copy',outPath]`.
- THÊM `spawnFfmpegConcat(listPath, outPath): ChildProcess` = `spawn(FFMPEG_PATH, buildConcatArgs(...), { windowsHide: true })`.
- KHÔNG đụng `buildFfmpegArgs`/`spawnFfmpeg`/`redactUrl`.
- (Wrapper await-exit đặt ở service — T004, không ở util.)

**DoD**: 2 hàm mới; SEC-01 không log path thô; hàm cũ không đổi; tsc sạch.

---

## T002 — [MODIFY additive] `RecordingSessionService.pauseVideo` (UC-114)
**File**: `src/modules/recording/services/recording-session.service.ts`
**Bám plan §1.1 A–E**:
- Chữ ký `pauseVideo(meetingId, sessionId, userId): Promise<{recordingSessionId, status, pauseCount}>`.
- A. Load session (SELECT id, meeting_id, status, storage_path, metadata_json, paused_duration_seconds) → `!session || meeting_id≠meetingId` → 404 `RECORDING_SESSION_NOT_FOUND`.
- B. Guard `status === 'recording'` → else 409 `RECORDING_NOT_RECORDING`.
- C. `processManager.markStopping(sessionId)` **TRƯỚC** `await processManager.stop(sessionId)` (tránh markFailed — BR-05). File segment hiện tại đóng sạch.
- D. `segments = metadata_json.segments ?? []`; nếu `storage_path` chưa nằm trong segments → push (segment đầu = `{sessionId}.mp4`). `merged = {...metadata_json, segments, paused_at: nowISO, pause_count: (cũ??0)+1}` (KHÔNG ghi đè orphan_stop/recovered). `UPDATE ... SET status='paused', metadata_json=$merged WHERE id`.
- E. **KHÔNG audit**.

**DoD**: markStopping trước stop; status=paused; segments push; paused_at+pause_count set; merge không đè key cũ; KHÔNG audit; tsc sạch.

---

## T003 — [MODIFY additive] `RecordingSessionService.resumeVideo` (UC-115)
**File**: `src/modules/recording/services/recording-session.service.ts`
**Bám plan §1.2 A–F**:
- Chữ ký `resumeVideo(meetingId, sessionId, userId): Promise<{recordingSessionId, status, pausedDurationSeconds}>`.
- A. Load session (kèm `device_id`, `paused_duration_seconds`, `metadata_json`, `started_at`) → 404 nếu không có/khác meeting.
- B. Guard `status === 'paused'` → else 409 `RECORDING_NOT_PAUSED`.
- C. Dựng url: SELECT `iot_devices.metadata_json.rtsp_config` theo `device_id`; `cfg` không có → 502 `RECORDING_NO_VIDEO` (hoặc 400 RTSP_NOT_CONFIGURED — chốt khi code); `url = buildRtspUrl(cfg)` (in-memory, KHÔNG log).
- D. `n = segments.length`; `segMới = baseDir/{sessionId}_seg{n}.mp4`. `processManager.start(sessionId, url, segMới)`; `probe = probeStart(sessionId, segMới)`.
  - `probe ∈ {exited, no_data}` → `processManager.stop(sessionId)` + **GIỮ `status='paused'`** (KHÔNG cộng pausedDuration, KHÔNG push segMới, KHÔNG mất segment cũ) → 502 `RECORDING_NO_VIDEO` (C5).
- E. `probe === 'capturing'`: `pausedInc = floor((now − Date(paused_at))/1000)` (paused_at thiếu → 0, log — E10); `pausedDurationSeconds += pausedInc`; `segments=[...cũ, segMới]`; xoá `paused_at`; `UPDATE status='recording', paused_duration_seconds=$new, storage_path=$segMới, metadata_json=$merged`.
- F. **KHÔNG audit**.

**DoD**: dựng url qua buildRtspUrl+rtsp_config; segment mới `_seg{n}`; no-data→giữ paused+502 (không cộng/không mất); OK→cộng pausedDuration+xóa paused_at+recording+storage_path=segMới; KHÔNG audit; tsc sạch.

---

## T004 — [MODIFY] `RecordingSessionService.stopVideo` — concat branch
**File**: `src/modules/recording/services/recording-session.service.ts`
**Bám plan §1.3**. Chèn nhánh segment TRƯỚC finalize, GIỮ khung hiện tại (:246-364):
- Nếu `status==='recording' && processManager.has` → stop process segment cuối (đóng file) → push `storage_path` vào segments nếu chưa. Nếu `status==='paused'` → không có process (đã stop lúc pause), bỏ qua stop.
- `segList = metadata_json.segments ?? []`; **lọc** bỏ file không tồn tại / 0-byte.
- **Nhánh (a)** `segList.length === 0` (session **chưa từng pause** — luồng cũ): GIỮ NGUYÊN `finalizeFileToStopped(storagePath cũ)`. **KHÔNG concat** (BR-06).
- **Nhánh (b)** `segList.length === 1`: `finalizeFileToStopped(segList[0])` (không concat).
- **Nhánh (c)** `segList.length > 1`:
  - viết `list.txt` (mỗi dòng `file '<abs segment path>'`) vào tmp;
  - wrapper `spawnFfmpegConcat(listPath, {sessionId}_final.mp4)` → chờ `exit` (+timeout); `exitCode≠0` → 500 `RECORDING_STOP_FAILED`, **GIỮ** segment+list (C4), KHÔNG finalize;
  - `exitCode===0` → `finalizeFileToStopped(storagePath={sessionId}_final.mp4)` → xoá segment files + list.txt (C4).
- `duration` giữ công thức cũ − `paused_duration_seconds`; ffprobe file cuối trong finalize.
- KHÔNG đổi `finalizeFileToStopped` signature; KHÔNG đụng nhánh file-thiếu/rỗng hiện tại (5a).

**DoD**: nhánh (a) 0-pause y hệt (BR-06); (b) 1-segment không concat; (c) concat ra `_final.mp4`→finalize; concat lỗi 500 giữ segment; lọc 0-byte; pause→stop không stop process; 1 media_file/session; tsc sạch.

---

## T005 — [MODIFY additive] Controller — 2 handler
**File**: `src/modules/recording/controllers/recording-session.controller.ts`
- `@Post('live-meetings/:meetingId/recording/:sessionId/pause-video')` `@RequirePermissions('recording.video.stop')` → `pauseVideo`.
- `@Post('live-meetings/:meetingId/recording/:sessionId/resume-video')` `@RequirePermissions('recording.video.stop')` → `resumeVideo`.
- Guard `JwtAuthGuard`+`PermissionsGuard`; `@Param ParseUUIDPipe`; `@CurrentUser` userId; envelope `{success,message,data}`.
- KHÔNG đụng start/stop/status handler.

**DoD**: 2 endpoint đúng path/permission; route leaf tĩnh không collision `stop-video`; handler cũ không đổi; tsc sạch.

---

## T006 — [CREATE] Test pause/resume service (file riêng)
**File**: `src/modules/recording/services/recording-pause-resume.service.spec.ts`
- **P1** pause OK: `markStopping`+`stop` gọi; status=paused; segments push; paused_at set; pause_count=1.
- **P2** pause khi ≠recording → 409 `RECORDING_NOT_RECORDING`.
- **P3** pause session không tồn tại/khác meeting → 404.
- **P4** resume OK: segment mới `start` gọi; pausedDurationSeconds cộng; status=recording; paused_at xóa; storage_path=segMới.
- **P5** resume khi ≠paused → 409 `RECORDING_NOT_PAUSED`.
- **P6** resume no-data → GIỮ paused + 502; KHÔNG cộng pausedDuration; KHÔNG push segMới.
- **P7** pause 2 lần (đang paused gọi pause) → 409.
- **P8** resume nhiều lần → segments dài dần (`_seg1`,`_seg2`...).
- **P9** (BR-05) `markStopping` gọi **TRƯỚC** `stop` (assert invocationCallOrder).

**DoD**: 9 case pass; mock dataSource.query/processManager/probeStart/buildRtspUrl; static import; không đụng test cũ.

---

## T007 — [CREATE] Test stop-concat service (file riêng)
**File**: `src/modules/recording/services/recording-stop-concat.service.spec.ts`
- **S1** (BR-06) 0-pause (segments rỗng) → `finalizeFileToStopped(storagePath cũ)`, `spawnFfmpegConcat` **KHÔNG** gọi.
- **S2** 1 segment → `finalizeFileToStopped(segList[0])`, không concat.
- **S3** >1 segment → `spawnFfmpegConcat` gọi ra `{sessionId}_final.mp4` → finalize path đó.
- **S4** concat lỗi (exitCode≠0) → 500 `RECORDING_STOP_FAILED`; segment **không** bị xóa; **không** finalize.
- **S5** lọc 0-byte: segment 0-byte bị loại khỏi list trước concat.
- **S6** pause→stop (status=paused) → `processManager.stop` **không** gọi (không process); concat segments đã có.

**DoD**: 6 case pass; mock finalize/spawnFfmpegConcat/fs; **S1 chứng minh luồng cũ y hệt**; static import; không đụng test cũ.

---

## T008 — [CREATE] Test controller (file riêng)
**File**: `src/modules/recording/controllers/recording-pause-resume.controller.spec.ts`
- **C1** pause gọi service đúng `(meetingId,sessionId,userId)` + response envelope.
- **C2** resume gọi service đúng + response.
- **C3** `@RequirePermissions` = `['recording.video.stop']` cho cả 2 handler.
- **C4** route: pause path `.../:sessionId/pause-video`, resume `.../:sessionId/resume-video` (metadata PATH).

**DoD**: 4 case pass; overrideGuard; static import.

---

## T009 — Cổng chất lượng (KHÔNG commit)
- `tsc --noEmit` net +0 (production sạch).
- `eslint` file đã đụng (service, controller, ffmpeg.util, reconcile TODO, 3 test).
- `jest src/modules/recording` — suite mới pass (P1–P9, S1–S6, C1–C4) **+ suite cũ start/stop/status/media/config/process-manager/reconcile PHẢI vẫn pass** (0 regression — đặc biệt **start→stop 0-pause**).
- `jest src/modules/auth/guards` — 0 regression.
- Phân biệt baseline vs mới bằng `git stash`. **KHÔNG commit.**

**DoD**: tsc +0; eslint file đã đụng sạch; jest recording pass (mới + cũ, 0 regression); auth/guards 0 regression; bằng chứng git-stash. KHÔNG commit.

---

## Ma trận phủ
| Yêu cầu | Task |
| :--- | :--- |
| C1 permission reuse | T005, T008 (C3) |
| C2 metadata segments/paused_at | T002, T003, T006 (P1/P4/P8) |
| C3 concat _final.mp4 | T004, T007 (S3) |
| C4 concat OK xóa / lỗi giữ | T004, T007 (S3/S4) |
| C5 resume fail giữ paused+502 | T003, T006 (P6) |
| C6 reconcile TODO | (ghi trong T004 phần reconcile — chỉ comment) |
| C7 concat demuxer | T001, T004 |
| C8 endpoint pause/resume | T005, T008 (C4) |
| **BR-05 đoạn pause không ghi** | T002 (markStopping+stop), T006 (P9) |
| **BR-06 luồng cũ y hệt** | T004 nhánh (a), T007 (S1) |

## KHÔNG được làm
- KHÔNG migration/seed/commit; **KHÔNG audit pause/resume**.
- KHÔNG sửa `recording-process-manager.ts`; KHÔNG sửa reconcile-logic (chỉ TODO comment); KHÔNG đụng `startVideo` guard/no-data probe/`finalizeFileToStopped` signature/`RECORDING_ALREADY_ACTIVE`/media-files/config/audio/transcription.
- KHÔNG phá luồng 0-pause; KHÔNG đụng test start/stop cũ.

## Thứ tự
`T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009`

---

## Xác nhận bất biến qua các task
- **BR-05 (đoạn pause không ghi)**: T002 `markStopping`+`stop` đóng process/file → paused không start gì → T003 resume mới start segment mới. P9 assert order; đoạn pause→resume không byte nào ghi.
- **BR-06 (luồng cũ y hệt)**: T004 nhánh (a) segments rỗng → `finalizeFileToStopped(storagePath cũ)` không concat; S1 chứng minh; suite start/stop cũ vẫn pass (T009).

> Chưa code — chờ duyệt tasks.
