# SPEC — UC-114 (Tạm dừng ghi hình) + UC-115 (Tiếp tục ghi hình)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới spec.md CHUNG cho UC-114 + UC-115 (pause/resume theo cơ chế SEGMENT). [Partial]. | Toàn bộ file |

> Viết CHUNG 1 spec vì UC-114 và UC-115 dùng CHUNG cơ chế segment (pause ↔ resume ↔ stop-concat).
> ⚠️ UC nhạy cảm: đụng process ffmpeg realtime + storage + file I/O. Yêu cầu bảo mật cốt lõi:
> **đoạn giữa lúc pause TUYỆT ĐỐI không được ghi vào bất kỳ file nào** (admin/manager sau này cũng không xem được).
> KHÔNG code/plan/tasks. Bám code thật; chỗ chưa chắc → đánh dấu **[cần xác minh]**, KHÔNG bịa.

---

## 0. Khảo sát hiện trạng (bám code thật)

### 0.1. `RecordingProcessManager` (`recording-process-manager.ts`)
- `procs = Map<sessionId, ProcEntry{proc, stopping, stderrTail}>` — **1 sessionId ↔ 1 process** (không có khái niệm segment/nhiều process).
- `start(sessionId, url, outPath)`: `spawnFfmpeg(url, outPath)`; gắn handler `exit`/`error` → nếu chưa `stopping` thì `markFailed(session)` (set status=failed). ⚠️ Handler này coi mọi exit ngoài ý muốn là **failed** → pause (stop có chủ đích) phải `markStopping` trước để KHÔNG bị đánh failed.
- `stop(sessionId, timeout)`: `markStopping` → ghi `'q'` graceful → đợi `exit` → timeout `STOP_TIMEOUT_MS=3000` → `SIGKILL`. Trả `'exited'|'killed'|'orphan'`. **Luôn `procs.delete(sessionId)` khi kết thúc** (Map key theo sessionId).
- `waitForGrace`, `has`, `get`, `markStopping`. **KHÔNG có** pause/resume.
- ⚠️ Map key = `sessionId` ⇒ cơ chế segment (nhiều process cùng 1 session theo thời gian) khả thi vì tại một thời điểm chỉ có **≤1 process/session** (pause = stop segment cũ trước, resume = start segment mới). KHÔNG cần đổi kiểu Map.

### 0.2. `RecordingSessionService`
- `startVideo` (:64-212): sinh `sessionId`, `outPath = baseDir/{sessionId}.mp4` (**1 FILE**), INSERT session `status=recording`, `storagePath=outPath`, `processManager.start`, `probeStart` (poll file>0 trong `START_PROBE_MS=5000`, exit→failed, no-data→502 kill+failed).
- `stopVideo` (:246-364): load session; guard `status ∈ {starting,recording,paused}` else `409 RECORDING_NOT_ACTIVE`; `processManager.stop` (has→stop, else orphan); tính `duration = floor(stopped−started)/1000 − paused_duration_seconds`; nếu file thiếu/rỗng → stopped không tạo media_file; else `finalizeFileToStopped` (size+sha256+probe duration + transaction INSERT media_files + UPDATE session). **1 session → 1 media_file**.
- `finalizeFileToStopped` (:873): dùng chung bởi stopVideo + reconcile; INSERT **1** media_files từ **1** `storagePath`; `fileName={sessionId}.mp4`.
- `getStatus` (:986): live khi `status=recording && stopped_at null`; duration wall-clock trừ `paused_duration_seconds`.
- Guard active tại `startVideo` (:122-136): `status IN ('starting','recording','paused')` → `RECORDING_ALREADY_ACTIVE` (**paused vẫn tính active** — không cho start mới đè).

### 0.3. `RecordingSessionEntity`
- `status` enum: `starting/recording/paused/stopped/failed/processing` — **`paused` đã có**.
- `pausedDurationSeconds` (integer, default 0) — **cột có, chưa có logic set**.
- `metadataJson` (jsonb, nullable) — **có** → dùng lưu `segments[]` + `paused_at` mà **KHÔNG cần thêm cột**.
- `storagePath` (text) — hiện 1 path. `startedAt/stoppedAt`, `durationSeconds`, `fileSizeBytes`, `checksum`.
- **KHÔNG có cột** `paused_at` / `segments` riêng.

### 0.4. `ffmpeg.util`
- `buildFfmpegArgs(url, outPath)`: RTSP tcp → `-map 0:v:0` (video-only) → `-c copy` → `-movflags +frag_keyframe+empty_moov` → `-f mp4` → **1 outPath**. Fragmented mp4.
- `spawnFfmpeg(url, outPath)`: `spawn(FFMPEG_PATH, buildFfmpegArgs(...))`. **KHÔNG có** helper concat.
- ⇒ Concat cần **hàm mới** (concat demuxer: `-f concat -safe 0 -i list.txt -c copy out.mp4`). **[cần xác minh]** concat demuxer với **fragmented mp4** (`+frag_keyframe+empty_moov`, `-c copy`) — thường chạy được khi cùng codec/nguồn, nhưng fragmented header cần kiểm chứng thực tế trước khi chốt.

### 0.5. Controller + RBAC (⚠️ mâu thuẫn actor)
- `POST live-meetings/:meetingId/recording/start-video` → `recording.video.start`.
- `POST live-meetings/:meetingId/recording/:sessionId/stop-video` → `recording.video.stop`.
- **Permission `recording.video.start/stop/status` → roles `[SYSTEM_ADMIN, MANAGER]`**; controller **chỉ guard permission** (KHÔNG `assertHostOrAdmin` cho start/stop video).
- **Mâu thuẫn**: UC list ghi UC-114/115 actor = **Internal User (Host)**, nhưng cơ chế video recording hiện hành gác bằng **`[SYSTEM_ADMIN, MANAGER]`** (không phải Host). Theo CLAUDE.md (ưu tiên convention hiện có + nhất quán), spec đề xuất **mirror start/stop** (permission-gated Manager/Admin) thay vì áp Host-relationship-check (start/stop không có). ⇒ Điểm cần chốt §11-C1.

### 0.6. Reconcile (REC-004)
- `RecordingReconcileService` xử lý session mồ côi (crash) → dùng `finalizeFileToStopped` (giả định **1 `storagePath`**). ⇒ Với segment, reconcile cần biết concat segments — **[cần xác minh / mở rộng]** §11-C6.

→ **UC-114/115 = [Partial]**: schema có `paused` status + `pausedDurationSeconds` nhưng **chưa có logic** pause/resume/segment/concat.

---

## 1. Quyết định kiến trúc (đã chốt — KHÔNG mở lại)

**Cơ chế SEGMENT** (không dùng pause-logic của ffmpeg — ffmpeg chạy tiếp là RỦI RO ghi lén đoạn pause):
1. 1 recording session = **N segment file**. **Pause** → `stop` ffmpeg segment hiện tại (flush graceful, đóng file sạch). **Resume** → `start` ffmpeg **segment mới**. Đoạn giữa pause **không có process ghi** ⇒ không tồn tại trong bất kỳ file nào (đạt yêu cầu bảo mật).
2. **Concat khi stopVideo**: gộp N segment theo thứ tự → 1 file cuối (ffmpeg concat demuxer) → `finalizeFileToStopped` thành **1 media_file** (consumer media-files list/playback **KHÔNG đổi** — vẫn 1 file/session).
3. Được sửa `RecordingProcessManager` + `startVideo`/`stopVideo` (mở rộng), NHƯNG **luồng cũ start→stop (không pause) phải hoạt động y hệt** (test đảm bảo). Không phá `RECORDING_ALREADY_ACTIVE`, reconcile, media_file finalize.
4. Pause/resume **nhiều lần** (không giới hạn).
5. `pausedDurationSeconds` = **cộng dồn** thời gian các khoảng pause; cần track `paused_at` mỗi lần pause.

---

## 2. UC-114 — Tạm dừng ghi hình

| Thuộc tính | Giá trị |
| :--- | :--- |
| Actor | Internal User (Host) *(thực thi: mirror `recording.video.stop` — Manager/Admin; xem §0.5, §11-C1)* |
| Trigger | Host tạm dừng recording đang chạy. |
| Pre-condition | Recording session tồn tại và `status = recording`. |
| Expected Output | Session `status = paused`, dữ liệu segment hiện tại được **flush an toàn** (file đóng sạch); không process ghi trong lúc paused. |

**Main flow (UC-114)**:
1. Actor gọi `POST .../recording/:sessionId/pause-video`.
2. Load session (thuộc meeting) → không có → **404 `RECORDING_SESSION_NOT_FOUND`**.
3. Guard `status = recording` → nếu không → **409 `RECORDING_NOT_RECORDING`** (đang paused/stopped/... không pause được).
4. `processManager.markStopping(sessionId)` (tránh bị đánh failed) → `processManager.stop(sessionId)` graceful (`'q'`→timeout→kill) → **file segment hiện tại đóng sạch**.
5. Ghi segment path hiện tại vào danh sách `metadata_json.segments[]`; set `status = paused`, `metadata_json.paused_at = now` (mốc tính pausedDuration + resume).
6. Trả 200 `{ success, message, data: { status: 'paused', ... } }`.

**Exception (UC-114)**: 404 session; 409 không đang recording; segment file rỗng/0 byte lúc pause (§ edge E7).

---

## 3. UC-115 — Tiếp tục ghi hình

| Thuộc tính | Giá trị |
| :--- | :--- |
| Actor | Internal User (Host) *(mirror như §2)* |
| Trigger | Host tiếp tục recording đang tạm dừng. |
| Pre-condition | Recording session tồn tại và `status = paused`. |
| Expected Output | Session `status = recording`, ghi tiếp bằng **segment mới**; realtime cập nhật. |

**Main flow (UC-115)**:
1. Actor gọi `POST .../recording/:sessionId/resume-video`.
2. Load session → không có → **404 `RECORDING_SESSION_NOT_FOUND`**.
3. Guard `status = paused` → nếu không → **409 `RECORDING_NOT_PAUSED`**.
4. Dựng lại RTSP url (in-memory, không log — như `startVideo`; **[cần xác minh]** camera/rtsp_config vẫn còn để resume; nếu camera đổi cấu hình giữa chừng → xử lý §E4).
5. Sinh segment path mới: `{sessionId}_seg{n}.mp4` (n tăng dần). `processManager.start(sessionId, url, segPathMới)` + `probeStart` (mirror no-data probe) → segment mới ghi được → tiếp tục; exit/no-data → §E5.
6. Cộng `(now − paused_at)` (giây) vào `pausedDurationSeconds`; xoá `metadata_json.paused_at`; set `status = recording`; cập nhật `storagePath` = segment mới đang ghi (hoặc giữ path segment đầu — §11-C3).
7. Trả 200 `{ success, message, data: { status: 'recording', ... } }`.

**Exception (UC-115)**: 404 session; 409 không đang paused; segment mới start fail/no-data (§E5).

---

## 4. Endpoints

```
POST /api/v1/live-meetings/:meetingId/recording/:sessionId/pause-video     (UC-114)
POST /api/v1/live-meetings/:meetingId/recording/:sessionId/resume-video    (UC-115)
```
| | |
| :--- | :--- |
| Method / status | `POST` / 200 |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `recording.video.pause` / `recording.video.resume` (mới) **hoặc** tái dùng `recording.video.stop` — §11-C1 |
| Response | `{ success, message, data: { recordingSessionId, status, pausedDurationSeconds?, ... } }` |

Mirror path `start-video`/`stop-video`. Route `:sessionId/pause-video` và `:sessionId/resume-video` là leaf tĩnh riêng → không collision với `:sessionId/stop-video`.

---

## 5. Cơ chế stop (sửa `stopVideo` — concat)
- Session có **nhiều segment** (đã pause ≥1 lần): tại stop → nếu đang `recording` thì stop process segment cuối trước (đóng file) → thêm vào `segments[]`; **concat** toàn bộ `segments[]` theo thứ tự → 1 file cuối → `finalizeFileToStopped(storagePath=fileConcat)`.
- Session **1 segment** (không pause): giữ nguyên luồng cũ (`finalizeFileToStopped` trên `storagePath` sẵn có) — **KHÔNG concat** (đảm bảo hành vi cũ y hệt).
- **pause→stop** (đang `paused` mà stop): không có process sống (đã stop lúc pause) → bỏ qua `processManager.stop` (orphan) → concat các segment đã đóng.
- Concat demuxer cần **file list tạm** (`list.txt` liệt kê từng segment) — tạo trong tmp, xoá sau. **Cleanup segment** sau khi concat thành công (§11-C4: xoá segment ngay hay giữ tới khi finalize xong).
- `duration`: giữ công thức `floor(stopped−started)/1000 − pausedDurationSeconds`; ffprobe trên file concat cho duration thật (fallback wall-clock) — như `finalizeFileToStopped`.

---

## 6. Data model (ưu tiên `metadata_json`, KHÔNG thêm cột)
Lưu trong `recording_sessions.metadata_json` (jsonb có sẵn):
```
metadata_json = {
  segments: [ "{sessionId}.mp4", "{sessionId}_seg1.mp4", ... ],   // thứ tự ghi
  paused_at: "2026-07-14T..Z" | (xoá khi resume/stop),
  pause_count: n,
  ...(giữ nguyên orphan_stop/recovered nếu có)
}
```
- `pausedDurationSeconds` (cột sẵn) = tổng khoảng pause.
- **KHÔNG thêm cột** `paused_at`/`segments` → không migration. Nếu team muốn cột riêng (query/analytics) → **đề xuất chờ duyệt** (migration riêng) §11-C2.

---

## 7. Business rules
- BR-01: pause khi `status ≠ recording` → 409 `RECORDING_NOT_RECORDING`.
- BR-02: resume khi `status ≠ paused` → 409 `RECORDING_NOT_PAUSED`.
- BR-03: pause/resume session không tồn tại / không thuộc meeting → 404 `RECORDING_SESSION_NOT_FOUND`.
- BR-04: `RECORDING_ALREADY_ACTIVE` giữ nguyên — `paused` vẫn tính active (startVideo :126 đã gồm `paused`) → không cho start session mới đè.
- BR-05: đoạn pause KHÔNG có process ghi (yêu cầu bảo mật) — bất biến quan trọng nhất.
- BR-06: luồng start→stop (0 pause) hành vi/output y hệt hiện tại (1 media_file, 1 storagePath, không concat).

---

## 8. Quyền / RBAC (điểm chốt §11-C1)
- Thực tế: `recording.video.start/stop` → `[SYSTEM_ADMIN, MANAGER]`, permission-only (không Host-check).
- Đề xuất: **permission mới `recording.video.pause` + `recording.video.resume`**, role-set = **`[SYSTEM_ADMIN, MANAGER]`** (mirror stop), seed **KHÔNG execute**. Hoặc **tái dùng `recording.video.stop`** (pause/resume là control action như stop) → không seed mới.
- Actor UC list (Host) mâu thuẫn convention hiện hành → nêu rõ, đề xuất theo Manager/Admin. Nếu team muốn cho Host → cần thêm `assertHostOrAdmin` (start/stop hiện KHÔNG có) — thay đổi lớn hơn, chờ chốt.

## 9. Audit
- pause/resume ghi `audit_logs`: `actionType ∈ {pause_recording, resume_recording}`, `entityType='recording_session'`, `entityId=sessionId`, `newValueJson={status, pausedDurationSeconds?, segmentIndex?}`, severity INFO. Fail-separate (mirror convention recording không rollback do audit).

---

## 10. ⚠️ Edge cases (UC này sống chết ở đây — liệt kê đầy đủ)
| # | Tình huống | Xử lý đề xuất |
| :--- | :--- | :--- |
| E1 | pause rồi **stop** (không resume) | stop bỏ qua process (đã đóng), concat các segment đã có → finalize. |
| E2 | resume **nhiều lần** | mỗi resume tạo segment mới `_seg{n}`; segments[] tăng; hợp lệ. |
| E3 | **pause 2 lần** liên tiếp (đang paused gọi pause) | 409 `RECORDING_NOT_RECORDING` (BR-01). Tương tự resume khi đang recording → 409 (BR-02). |
| E4 | camera **rớt lúc paused** | không process nào chạy khi paused ⇒ không ảnh hưởng; resume sẽ probe segment mới, no-data → §E5. |
| E5 | ffmpeg **segment mới start fail/no-data** lúc resume | mirror `startVideo` no-data: stop+`RECORDING_NO_VIDEO` 502 **[cần chốt]** giữ session ở paused (rollback status) hay chuyển failed — đề xuất: **giữ paused** + trả 502 để Host thử resume lại (không mất segment cũ). §11-C5. |
| E6 | concat **1 segment** / segment **0 byte** / lỗi concat | 1 segment → không concat (luồng cũ). 0-byte segment → loại khỏi list trước concat. Concat lỗi → 500 `RECORDING_STOP_FAILED`, KHÔNG mất segment (giữ file). §11-C4. |
| E7 | segment file **rỗng lúc pause** (chưa ghi được byte) | không thêm vào segments[] (hoặc thêm nhưng loại khi concat) — tránh concat file rỗng. |
| E8 | **crash giữa chừng** để lại segment mồ côi | reconcile (REC-004) hiện giả định 1 storagePath → cần biết segments[] để concat/finalize. **[cần xác minh/mở rộng]** §11-C6. |
| E9 | process exit **ngoài ý muốn** khi đang recording (chưa pause) | `markFailed` như hiện tại (không đổi) — pause phải `markStopping` trước để không dính nhánh này. |
| E10 | `paused_at` thiếu/hỏng lúc resume | fallback: cộng 0 vào pausedDuration (không crash), log cảnh báo. |

---

## 11. Điểm cần chốt (đánh số để duyệt)
| # | Vấn đề | Đề xuất |
| :--- | :--- | :--- |
| **C1** | Permission + actor (Host vs Manager/Admin) | Mirror stop: `recording.video.pause`/`resume` role `[SYSTEM_ADMIN,MANAGER]` (hoặc tái dùng `recording.video.stop`). KHÔNG áp Host-check (start/stop không có). |
| **C2** | Lưu segments/paused_at ở `metadata_json` hay thêm cột | **`metadata_json`** (không migration). Cột riêng → chờ duyệt. |
| **C3** | `storagePath` khi có nhiều segment | Giữ trỏ segment đầu (làm mốc), hoặc cập nhật segment đang ghi; concat ghi ra path cuối `{sessionId}.mp4`. Chốt path cuối. |
| **C4** | Cleanup segment sau concat + xử lý concat lỗi | Concat OK → xoá segment; concat lỗi → 500, GIỮ segment (không mất dữ liệu). |
| **C5** | Resume mà segment mới no-data/fail | Giữ `paused` + 502 (cho retry) thay vì chuyển failed. |
| **C6** | Reconcile segment mồ côi (crash) | Mở rộng reconcile đọc `segments[]` để concat; nếu ngoài scope UC-114/115 → ghi TODO + xử lý tối thiểu (finalize segment cuối). Chờ chốt phạm vi. |
| **C7** | Concat demuxer với fragmented mp4 (`+frag_keyframe+empty_moov`, `-c copy`) | **[cần xác minh]** chạy thử thực tế; nếu lỗi → cân nhắc `-movflags` khác cho segment hoặc re-mux. |
| **C8** | Endpoint tên `pause-video`/`resume-video` | Mirror `start-video`/`stop-video`. |

---

## 12. Ranh giới
- CHỈ pause (UC-114) + resume (UC-115) + sửa `stopVideo` (concat) + mở rộng `RecordingProcessManager` (thêm segment start/stop, KHÔNG đổi kiểu Map key).
- KHÔNG đụng: recording-config, media-files list/playback, audio session/upload, transcription (concat giữ 1 media_file ⇒ consumer không đổi).
- KHÔNG phá: `RECORDING_ALREADY_ACTIVE`, no-data probe, `finalizeFileToStopped` (1 file), luồng start→stop 0-pause.

---

## 13. [Partial] — Tóm tắt cần làm
**Trạng thái: [Partial]** — schema đã có `status=paused` + `pausedDurationSeconds` nhưng **chưa có logic** pause/resume/segment/concat.

Cần làm (ở plan/tasks sau):
1. `RecordingProcessManager`: đảm bảo start/stop theo segment path (Map key sessionId giữ nguyên); pause = markStopping+stop; resume = start segment mới.
2. `RecordingSessionService.pauseVideo` (UC-114) + `resumeVideo` (UC-115): validate status → thao tác process → cập nhật `status`/`segments[]`/`paused_at`/`pausedDurationSeconds`.
3. Sửa `stopVideo`: concat N segment (ffmpeg concat demuxer + list tạm + cleanup) → `finalizeFileToStopped`; 1-segment giữ luồng cũ.
4. Util concat mới (`buildConcatArgs`/`spawnFfmpegConcat`) — **[cần xác minh]** fragmented mp4.
5. Controller: 2 endpoint `pause-video`/`resume-video` + permission (C1).
6. Seed permission (nếu C1 chọn permission mới) — KHÔNG execute.
7. Audit pause/resume.
8. (Nếu C6) mở rộng reconcile cho segments.

**Điểm cần chốt trước khi code**: C1–C8 (§11) — đặc biệt **C1** (permission/actor), **C6** (reconcile segment), **C7** (concat fragmented mp4 khả thi), **C5** (resume fail).

**Bảo mật cốt lõi (bất biến)**: đoạn giữa pause KHÔNG có process ghi ⇒ không tồn tại trong bất kỳ file nào. Mọi thiết kế phải giữ bất biến này.
