# PLAN — UC-114 (pause) + UC-115 (resume) ghi hình

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-14 | Tạo mới plan.md CHUNG cho UC-114 + UC-115 (segment pause/resume + stop-concat). | Toàn bộ file |

> Dựa trên spec.md UC-114/115 đã duyệt. CHỈ kế hoạch — KHÔNG code/task.
> ⚠️ **BẤT BIẾN BR-05**: đoạn giữa pause TUYỆT ĐỐI không có process ffmpeg ghi → không tồn tại trong file nào. Mọi bước phải giữ bất biến này.
> Cơ chế SEGMENT: pause = stop ffmpeg (đóng file segment), resume = start ffmpeg segment mới, stop = concat N segment → 1 file.

---

## 0. Chốt (từ spec §11 — KHÔNG mở lại)
| # | Chốt |
| :--- | :--- |
| C1 | pause/resume **tái dùng permission `recording.video.stop`** (không seed mới). Guard `JwtAuthGuard`+`PermissionsGuard('recording.video.stop')`. |
| C2 | Lưu `metadata_json`: `segments:string[]` (path theo thứ tự), `paused_at:ISO`, `pause_count:number`. KHÔNG cột/migration. |
| C3 | Concat ghi ra `{sessionId}.mp4` (path cuối). Segment path: **segment đầu = `{sessionId}.mp4`** (giữ tên gốc `startVideo`), các segment sau = `{sessionId}_seg{n}.mp4` (n từ 1). |
| C4 | Concat OK → xoá segment + `list.txt`; concat lỗi → 500 `RECORDING_STOP_FAILED`, **GIỮ** segment (không mất data). |
| C5 | Resume mà segment mới no-data/fail → **GIỮ `paused`** + 502 `RECORDING_NO_VIDEO` (retry), không failed, không mất segment cũ. |
| C6 | Reconcile segment mồ côi **NGOÀI SCOPE** — chỉ ghi TODO comment trong reconcile, KHÔNG sửa logic. |
| C7 | Concat demuxer đã test khả thi: `ffmpeg -f concat -safe 0 -i list.txt -c copy {sessionId}.mp4` (fragmented mp4). |
| C8 | Endpoint `POST :sessionId/pause-video` + `:sessionId/resume-video`. |

### ⚠️ Convention path segment (C3 chốt rõ)
- Segment đầu: `{sessionId}.mp4` (do `startVideo` tạo sẵn — GIỮ NGUYÊN, không đổi).
- Sau mỗi resume lần k: `{sessionId}_seg{k}.mp4` (k = 1, 2, ...).
- `metadata_json.segments[]` = danh sách theo thứ tự ghi: `["{sessionId}.mp4", "{sessionId}_seg1.mp4", ...]`.
- File concat cuối: `{sessionId}.mp4` — **trùng tên segment đầu** ⇒ concat phải ghi ra **path tạm** (`{sessionId}_concat.mp4`) rồi **rename** về `{sessionId}.mp4` sau khi xoá segment đầu, HOẶC concat ra `{sessionId}_final.mp4` và finalize path đó. **[chốt ở tasks]** — đề xuất: concat ra `{sessionId}_final.mp4` → finalize path đó (tránh đụng tên segment đầu khi chưa xoá). Ghi rõ để tránh ghi đè input khi đang concat.

---

## 1. Kiến trúc & luồng (3 thao tác)

### 1.1. PAUSE (UC-114) — `pauseVideo`
```
Controller.pauseVideo (POST :sessionId/pause-video, recording.video.stop)
  → Service.pauseVideo(meetingId, sessionId, userId):
    A. Load session (SELECT ... WHERE id) → !session || meeting_id≠meetingId → 404 RECORDING_SESSION_NOT_FOUND
    B. Guard status === 'recording' → else 409 RECORDING_NOT_RECORDING
    C. processManager.markStopping(sessionId)  // TRÁNH markFailed (BR-05 an toàn)
       await processManager.stop(sessionId)     // 'q' graceful → timeout → kill; file segment ĐÓNG SẠCH
    D. segmentPath hiện tại = storage_path (hoặc segment cuối trong segments[])
       metadata_json.segments = [...cũ, segmentPath] (nếu chưa có)
       metadata_json.paused_at = now(ISO); metadata_json.pause_count = (cũ ?? 0)+1
       UPDATE recording_sessions SET status='paused', metadata_json=$merged WHERE id=$sessionId
    E. audit pause_recording (fail-separate)
  → 200 { recordingSessionId, status:'paused', pauseCount }
```
- **BR-05**: sau bước C, KHÔNG còn process nào ghi ⇒ đoạn từ giờ tới resume không vào file nào.
- markStopping bắt buộc TRƯỚC stop (nếu không, exit-handler của ProcessManager sẽ `markFailed` → sai).

### 1.2. RESUME (UC-115) — `resumeVideo`
```
Controller.resumeVideo (POST :sessionId/resume-video, recording.video.stop)
  → Service.resumeVideo(meetingId, sessionId, userId):
    A. Load session → 404 nếu không có/khác meeting
    B. Guard status === 'paused' → else 409 RECORDING_NOT_PAUSED
    C. Dựng lại RTSP url (in-memory, KHÔNG log): lấy device_id của session → SELECT iot_devices.metadata_json.rtsp_config
       → buildRtspUrl(cfg) (private sẵn có). rtsp_config mất/đổi → §E4/502.
    D. n = segments.length (số segment hiện có); segMới = {sessionId}_seg{n}.mp4 (path baseDir)
       processManager.start(sessionId, url, segMới)  // segment mới
       probe = probeStart(sessionId, segMới)          // tái dùng no-data probe
       - probe 'exited'/'no_data' → processManager.stop(sessionId) + GIỮ status='paused'
         → 502 RECORDING_NO_VIDEO (C5). KHÔNG cộng pausedDuration, KHÔNG mất segment cũ.
    E. probe 'capturing':
       pausedSeconds += floor(now − paused_at)/1000 → pausedDurationSeconds += pausedSeconds
       metadata_json.segments = [...cũ, segMới]; xoá metadata_json.paused_at
       storage_path = segMới (đang ghi — làm live cho getStatus)
       UPDATE status='recording', paused_duration_seconds=$new, storage_path=$segMới, metadata_json=$merged
    F. audit resume_recording (fail-separate)
  → 200 { recordingSessionId, status:'recording', pausedDurationSeconds }
```
- **[cần khảo sát khi code]** cách lấy lại `device_id` + `rtsp_config`: session có `device_id`; startVideo lấy `iot_devices.metadata_json.rtsp_config` (:88-119). resume lặp lại truy vấn này. `buildRtspUrl` private đã có.

### 1.3. STOP sửa (`stopVideo` — concat branch)
```
stopVideo (giữ khung hiện tại :246-364), CHÈN nhánh segment TRƯỚC finalize:
  - Load session (đã có: status, storage_path, started_at, paused_duration_seconds, metadata_json).
  - Nếu status==='recording' && processManager.has: stop process segment cuối (đóng file) → push vào segments[] nếu chưa.
  - Nếu status==='paused': không có process (đã stop lúc pause) — segments[] đã đủ; bỏ qua stop.
  - segList = metadata_json.segments ?? []; lọc bỏ file 0-byte / không tồn tại.
  - NHÁNH:
    (a) segList.length === 0  (luồng cũ 0-pause, session chưa từng pause):
        → GIỮ NGUYÊN logic hiện tại: finalizeFileToStopped(storagePath cũ). BR-06. KHÔNG concat.
    (b) segList.length === 1: → finalizeFileToStopped(segList[0]) (không cần concat).
    (c) segList.length > 1: → concat:
        - viết list.txt (mỗi dòng: file '<abs segment path>')  vào tmp
        - spawnFfmpegConcat(listPath, {sessionId}_final.mp4) → chờ exit
          - exit≠0 → 500 RECORDING_STOP_FAILED, GIỮ segment + list (C4), KHÔNG finalize
          - exit=0 → finalizeFileToStopped(storagePath={sessionId}_final.mp4)
        - concat OK: xoá segment files + list.txt (C4). (Rename/định danh path cuối theo C3.)
  - duration: giữ công thức floor(stopped−started)/1000 − paused_duration_seconds; ffprobe file cuối cho duration thật (finalizeFileToStopped làm).
```
- ⚠️ **BR-06**: nhánh (a) — session **chưa từng pause** (segments rỗng) — chạy Y HỆT hiện tại. Test chứng minh.
- 1 media_file/session giữ nguyên (consumer media-files/playback KHÔNG đổi).

---

## 2. `RecordingProcessManager` (mở rộng tối thiểu)
- `start(sessionId, url, outPath)` + `stop(sessionId)` + `markStopping` **ĐÃ ĐỦ** cho segment: Map key = `sessionId`, tại một thời điểm ≤1 process/session (pause stop trước, resume start sau). **KHÔNG cần đổi kiểu Map, KHÔNG cần helper mới.**
- resume gọi `start` với `outPath` = segment mới; pause gọi `markStopping`+`stop`.
- Bất biến: `stop` luôn `procs.delete(sessionId)` → resume `start` set lại entry mới cho cùng sessionId. **[xác nhận khi code]** không có entry cũ sót (stop đã delete).
- ⇒ Đề xuất: **KHÔNG sửa `recording-process-manager.ts`** (dùng nguyên API). Nếu phát sinh cần (vd getSegmentIndex) → nêu ở tasks; hiện KHÔNG cần.

## 3. Util concat mới (`ffmpeg.util.ts`)
```
export function buildConcatArgs(listPath, outPath): string[] {
  return ['-f','concat','-safe','0','-i',listPath,'-c','copy',outPath];
}
export function spawnFfmpegConcat(listPath, outPath): ChildProcess {
  return spawn(FFMPEG_PATH, buildConcatArgs(listPath, outPath), { windowsHide: true });
}
```
- SEC-01: path segment/list KHÔNG chứa credential (khác RTSP url) → an toàn; vẫn giữ convention không log path thô nếu ghi log lỗi (redact best-effort).
- Concat chạy **đồng bộ chờ exit** (concat `-c copy` nhanh): service bọc `spawnFfmpegConcat` trong Promise chờ `exit`/`error` + timeout, đọc `exitCode`. **KHÔNG** cần realtime probe. (Không đưa vào `RecordingProcessManager` — đây là tác vụ 1 lần khi stop, không phải long-running session process.)

## 4. Data model `metadata_json` (C2)
```
metadata_json = {
  ...(giữ nguyên orphan_stop / recovered nếu có),
  segments: ["{sessionId}.mp4", "{sessionId}_seg1.mp4", ...],
  paused_at: "ISO" (chỉ tồn tại khi đang paused; xoá khi resume/stop),
  pause_count: n,
}
```
- Đọc: `const meta = session.metadata_json ?? {}`; merge `{...meta, segments, paused_at, pause_count}` — KHÔNG ghi đè key cũ.
- Ghi: `UPDATE ... SET metadata_json = $JSON.stringify(merged)`.
- `pausedDurationSeconds` = cột sẵn (integer). resume cộng dồn.

## 5. Endpoints + route order
```
POST /api/v1/live-meetings/:meetingId/recording/:sessionId/pause-video   → recording.video.stop
POST /api/v1/live-meetings/:meetingId/recording/:sessionId/resume-video  → recording.video.stop
```
- Mirror `start-video`/`stop-video`. `:sessionId/pause-video` và `:sessionId/resume-video` là leaf tĩnh riêng, khác segment cuối với `:sessionId/stop-video` ⇒ **không collision**.

## 6. Business rules mapping
| BR | Xử lý |
| :--- | :--- |
| BR-01 pause khi ≠recording → 409 RECORDING_NOT_RECORDING | pauseVideo bước B. |
| BR-02 resume khi ≠paused → 409 RECORDING_NOT_PAUSED | resumeVideo bước B. |
| BR-03 session 404 | pause/resume bước A (id + meeting_id). |
| BR-04 RECORDING_ALREADY_ACTIVE giữ (paused vẫn active) | KHÔNG đụng startVideo guard (:126 đã gồm paused). |
| **BR-05 đoạn pause không ghi** | pause stop process (bước C) → không process tới khi resume start segment mới. Bất biến. |
| BR-06 start→stop 0-pause y hệt | stopVideo nhánh (a) giữ nguyên finalizeFileToStopped(storagePath). |

## 7. Error map
| Tình huống | Exception | HTTP | code |
| :--- | :--- | :--- | :--- |
| session không tồn tại/khác meeting | NotFoundException | 404 | RECORDING_SESSION_NOT_FOUND |
| pause khi ≠recording | ConflictException | 409 | RECORDING_NOT_RECORDING |
| resume khi ≠paused | ConflictException | 409 | RECORDING_NOT_PAUSED |
| resume segment mới no-data/fail | BadGatewayException | 502 | RECORDING_NO_VIDEO (giữ paused — C5) |
| concat lỗi khi stop | InternalServerErrorException | 500 | RECORDING_STOP_FAILED (giữ segment — C4) |
| param sai uuid | ParseUUIDPipe | 400 | — |

## 8. Audit plan
- pause: `actionType='pause_recording'`; resume: `actionType='resume_recording'`; `entityType='recording_session'`, `entityId=sessionId`, `newValueJson={status, pauseCount|pausedDurationSeconds}`, severity INFO.
- **Fail-separate** (mirror convention recording — audit lỗi không rollback thao tác process/DB). **[xác nhận]** module recording ghi audit thế nào (nếu chưa có helper audit trong recording, dùng `dataSource` insert audit_logs fail-separate). Nếu recording hiện KHÔNG ghi audit ở start/stop → cân nhắc bỏ audit cho nhất quán (nêu ở tasks). ĐÁNH DẤU cần xác minh.

## 9. Edge cases (E1–E10 spec) → bước code
| E | Xử lý trong plan |
| :--- | :--- |
| E1 pause→stop không resume | stopVideo nhánh paused: không stop process, concat segments đã có. |
| E2 resume nhiều lần | mỗi resume `_seg{n}` tăng; segments[] dài dần (§1.2 D). |
| E3 pause 2 lần / resume khi recording | 409 (BR-01/BR-02). |
| E4 camera rớt lúc paused | không process khi paused; resume probe no-data → E5. |
| E5 segment mới fail lúc resume | GIỮ paused + 502 (C5, §1.2 D). |
| E6 concat 1 segment/0-byte/lỗi | lọc 0-byte; 1 segment không concat; concat lỗi 500 giữ file (§1.3 b/c). |
| E7 segment rỗng lúc pause | lọc khỏi segments trước concat (§1.3). |
| E8 crash → segment mồ côi | reconcile NGOÀI SCOPE — TODO comment (C6), không sửa. |
| E9 exit ngoài ý muốn khi recording | markFailed hiện tại (không đổi); pause markStopping trước để tránh nhánh này (§1.1 C). |
| E10 paused_at thiếu lúc resume | fallback cộng 0 vào pausedDuration + log; không crash (§1.2 E). |

---

## 10. File TẠO / SỬA

### 10.1. TẠO
| File | Vai trò |
| :--- | :--- |
| `src/modules/recording/services/recording-pause-resume.service.spec.ts` | Test pause/resume (file riêng). |
| `src/modules/recording/services/recording-stop-concat.service.spec.ts` | Test stopVideo concat branch (file riêng) — gồm BR-06 (0-pause y hệt). |
| `src/modules/recording/controllers/recording-pause-resume.controller.spec.ts` | Test controller 2 handler + RBAC + route. |
> KHÔNG seed (C1 reuse `recording.video.stop`).

### 10.2. SỬA (có kiểm soát)
| File | Thay đổi |
| :--- | :--- |
| `src/modules/recording/services/recording-session.service.ts` | THÊM `pauseVideo`, `resumeVideo`; SỬA `stopVideo` (chèn nhánh segment/concat, giữ nhánh (a) 0-pause y hệt); thêm helper concat-await + segment path. KHÔNG đụng startVideo guard/no-data/finalizeFileToStopped signature. |
| `src/modules/recording/controllers/recording-session.controller.ts` | THÊM 2 handler `pauseVideo`/`resumeVideo` (`recording.video.stop`). KHÔNG đụng start/stop handler. |
| `src/modules/recording/utils/ffmpeg.util.ts` | THÊM `buildConcatArgs` + `spawnFfmpegConcat`. KHÔNG đụng `buildFfmpegArgs`/`spawnFfmpeg`/`redactUrl`. |
| `src/modules/recording/services/recording-reconcile.service.ts` | CHỈ thêm **TODO comment** (C6): segment orphan chưa concat. KHÔNG đổi logic. |

> **KHÔNG sửa** `recording-process-manager.ts` (API đủ — §2). KHÔNG đụng recording-config/media-files list/playback/audio/transcription.

---

## 11. Giữ luồng cũ (BR-06 — liệt kê rõ)
Start→stop **0 pause** phải KHÔNG đổi hành vi:
- `startVideo`: nguyên vẹn (1 file `{sessionId}.mp4`, guard, no-data probe).
- `stopVideo`: session không có `metadata_json.segments` (hoặc rỗng) → nhánh (a) → `finalizeFileToStopped(storagePath cũ)` → 1 media_file. KHÔNG concat, KHÔNG đụng metadata segment.
- Test: suite start/stop cũ (`recording-session.service.spec` / process-manager spec) phải **vẫn pass** (0 regression) + test mới chứng minh nhánh (a) khi segments rỗng == luồng cũ.

## 12. Tác động code người khác
- SỬA có kiểm soát: `recording-session.service.ts` (thêm pause/resume + nhánh stop), `recording-session.controller.ts` (+2 handler), `ffmpeg.util.ts` (+2 hàm concat). Reconcile: chỉ TODO comment.
- **KHÔNG sửa** `recording-process-manager.ts`; **KHÔNG đụng** recording-config/media-files/audio/transcription/consumer; **KHÔNG phá** `RECORDING_ALREADY_ACTIVE`/no-data probe/`finalizeFileToStopped`.
- Test file riêng; test start/stop cũ vẫn pass.
- KHÔNG migration/seed execute.

## 13. Checklist
**TẠO**: 3 test spec riêng (pause/resume service, stop-concat service, controller).
**SỬA**: `recording-session.service.ts` (+pauseVideo/+resumeVideo/~stopVideo), `recording-session.controller.ts` (+2 handler), `ffmpeg.util.ts` (+buildConcatArgs/+spawnFfmpegConcat), `recording-reconcile.service.ts` (chỉ TODO C6).
**KHÔNG**: migration; seed; sửa process-manager/config/media-files/audio/transcription/reconcile-logic; phá luồng 0-pause.

## 14. Xác nhận bất biến BR-05 qua mọi bước
- **pause** (§1.1 C): `markStopping` + `stop` → process đóng, file segment đóng, `procs.delete`. Từ đây **không process ffmpeg nào của session tồn tại**.
- **trong lúc paused**: không có bước nào start process. camera rớt/không → vô hại (không ai ghi).
- **resume** (§1.2 D): chỉ lúc này mới `start` process mới ghi **segment mới** (file mới). Đoạn giữa (pause→resume) **không byte nào được ghi bất kỳ đâu**.
- **stop/concat**: chỉ gộp các segment ĐÃ ghi (đoạn active) — không có segment nào chứa đoạn pause. ⇒ **admin/manager không thể xem đoạn pause vì nó không tồn tại**.

> Chưa code — chờ duyệt plan.
