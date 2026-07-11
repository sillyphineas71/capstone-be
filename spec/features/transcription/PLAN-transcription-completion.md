# PLAN — Hoàn Thiện Feature Transcription

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-01 | Tạo plan từ session phân tích transcription | Toàn bộ file |
| 2026-07-01 | Phase 3 implemented: AI Worker multi-channel download + Python channel_zone pipeline | Giai Đoạn 3 |
| 2026-07-01 | Phase 4 implemented: WebSocket transcript.ready notification + meeting:subscribe handler | Giai Đoạn 4 |
| 2026-07-01 | Phase 5 implemented: GET transcription-jobs API endpoint | Giai Đoạn 5 |
| 2026-07-11 | Gap fix Giai Đoạn 1: phát hiện qua review — `audio-tracks` yêu cầu `sessionId` có sẵn nhưng chưa từng có API tạo audio session rỗng cho luồng multi-track thuần upload. Thêm `POST /meetings/{meetingId}/recording-sessions` (`createAudioSession`) làm điểm neo. Chi tiết: xem `API-ENDPOINTS-full-flow.md` mục 2.4. | Giai Đoạn 1 (thêm ghi chú cuối mục) |

---

## Bối Cảnh

Feature transcription hiện tại đã có luồng cơ bản hoạt động:
- Tạo job qua API → BullMQ queue → AI Worker spawn Python subprocess → faster-whisper STT → lưu `TranscriptEntity` status=DRAFT → in-app notification Host.
- GET transcript, PATCH sửa segment thủ công.

**Vấn đề cốt lõi còn thiếu:**
1. Không có cơ chế thu audio từ mic của từng người dùng riêng lẻ.
2. Pipeline hiện tại xử lý 1 file audio hỗn hợp → không biết ai nói đoạn nào (`speakerLabel: "unknown"` toàn bộ).
3. Không có WebSocket push realtime khi transcript xong.
4. Không có API kiểm tra trạng thái job.

**Hướng giải quyết đã thống nhất:**
- Mỗi participant tự upload file audio của mình sau khi họp xong (kèm userId từ JWT).
- Python pipeline chạy Whisper riêng cho từng user audio → merge theo timestamp → speaker đã biết mà không cần diarization.
- Đây là `speakerMappingMode: channel_zone` đã được thiết kế sẵn trong code nhưng chưa implement.

---

## Giai Đoạn 1 — API Nhận Audio Upload Từ Client

**Mục đích:** Cho phép từng participant upload file audio ghi âm của chính mình sau khi meeting kết thúc.

### Endpoint mới
```
POST /api/v1/meetings/:meetingId/recording-sessions/:sessionId/audio-tracks
Content-Type: multipart/form-data
Authorization: Bearer <JWT>
Body: file (audio binary)
```

### Logic
- Lấy `userId` từ JWT token (không nhận từ body).
- Validate:
  - Meeting tồn tại.
  - Meeting đã kết thúc (`status = ended`).
  - User là participant của meeting.
  - RecordingSession thuộc meeting này.
- Upload file lên MinIO với key: `meetings/{meetingId}/sessions/{sessionId}/{userId}/audio`.
- Thêm field `channelUserId uuid nullable` vào bảng `media_files` (migration cần thiết).
- Tạo `MediaFileEntity` mới:
  - `fileType = AUDIO`
  - `recordingSessionId = sessionId`
  - `channelUserId = userId`
  - `storageBucket`, `storageKey` trỏ vào MinIO
  - `isActive = true`

### File cần tạo / sửa
- `capstone-be/src/modules/recording/entities/media-file.entity.ts` — thêm field `channelUserId`
- `capstone-be/src/database/migrations/<timestamp>-AddChannelUserIdToMediaFiles.ts` — migration
- `capstone-be/src/modules/recording/dto/upload-audio-track.dto.ts` — DTO mới (không có field, chỉ validate file)
- `capstone-be/src/modules/recording/recording.controller.ts` — thêm endpoint
- `capstone-be/src/modules/recording/recording.service.ts` — thêm method `uploadAudioTrack()`

### Permission cần seed
- `recording.upload_track` — participant tự upload audio của mình

### Gap fix 2026-07-11 — API tạo audio session rỗng
Thiết kế gốc ở trên giả định `sessionId` đã tồn tại trước khi gọi `audio-tracks`,
nhưng không có endpoint nào tạo được audio session mà KHÔNG kèm sẵn 1 file
(session hiện chỉ sinh từ `start-video` — video — hoặc `audio-upload` — luôn kèm
1 file). Đã bổ sung `POST /meetings/:meetingId/recording-sessions`
(`RecordingSessionService.createAudioSession`) tạo 1 audio session "rỗng"
(`status=starting`, không file/process) làm điểm neo cho N participant lần lượt
gọi `audio-tracks`. Cùng permission/authz với `audio-upload`
(`transcript.create`, chỉ Host/Organizer hoặc Admin) — không cần permission mới.

---

## Giai Đoạn 2 — Cập Nhật TranscriptionJob Hỗ Trợ Multi-Channel

**Mục đích:** Khi tạo transcription job, service phải tìm tất cả audio file của session (1 per user) thay vì chỉ 1 file.

### Thay đổi trong `TranscriptionService.createTranscriptionJob()`
- Thay `mediaFileRepo.findOne(...)` → `mediaFileRepo.find(...)` lấy **tất cả** MediaFile `type=AUDIO, isActive=true` của session.
- Nếu không có file nào → 404 `SOURCE_MEDIA_NOT_FOUND`.
- Nếu chỉ có 1 file → tự động dùng `diarization_only` mode (backward-compatible).
- Nếu có nhiều file → tự động dùng `channel_zone` mode.
- Job payload thêm field `channels: Array<{ storageKey: string; storageBucket?: string; channelUserId: string }>`.
- `sourceMediaFileId` trong payload vẫn giữ để backward-compatible (trỏ vào file đầu tiên hoặc null).

### File cần sửa
- `capstone-be/src/modules/transcription/transcription.service.ts` — thay findOne → find, build channels array
- `capstone-be/workers/ai-transcription/src/transcription-job-runner.ts` — type `TranscriptionJobInput` thêm field `channels`

---

## Giai Đoạn 3 — Cập Nhật AI Worker & Python Pipeline (Channel Zone Mode)

**Đây là giai đoạn phức tạp nhất. Mọi thay đổi logic AI đều ở đây.**

### AI Worker Node (`transcription-job-runner.ts`)

**Thay đổi:**
- Khi `input.channels` có nhiều phần tử → tải nhiều file audio từ MinIO, lưu riêng:
  ```
  jobDir/
    channel-{userId-1}/source-audio
    channel-{userId-1}/normalized.wav
    channel-{userId-2}/source-audio
    channel-{userId-2}/normalized.wav
  ```
- Truyền vào Python argument `--channels-json` (JSON string của list `{normalizedPath, userId}`).
- Vẫn truyền `--input` là file audio đầu tiên để backward-compatible với mode `diarization_only`.
- Resource guard: tính tổng duration của tất cả channels (hoặc dùng channel dài nhất).

### Python Pipeline (`transcribe_pipeline.py`)

**Thêm nhánh `channel_zone` trong `run_pipeline()`:**

```python
if channels_json:
    # Channel zone mode
    all_segments = []
    for channel in channels_json:
        # preprocess từng channel
        audio_meta = preprocess_audio(channel['inputPath'], channel['normalizedPath'])
        # transcribe từng channel
        whisper_result = transcribe(channel['normalizedPath'], ...)
        # gán userId ngay, speakerSource='channel_zone'
        for raw_seg in whisper_result['segments']:
            seg = new_segment(...)
            seg['userId'] = channel['userId']
            seg['speakerLabel'] = channel['userId']  # hoặc tên user nếu có
            seg['speakerSource'] = 'channel_zone'
            all_segments.append(seg)
    # Gộp tất cả segments từ mọi channel, sort theo startMs
    all_segments.sort(key=lambda s: s['startMs'])
    # detect overlaps trên timeline đã gộp
    if overlap_detection_enabled:
        overlap_windows = detect_overlaps_from_segments(all_segments)
        mark_overlapping_segments(all_segments, overlap_windows)
    segments = all_segments
    # build detectedSpeakers từ segments
    detected_speakers = build_detected_speakers(segments)
else:
    # Mode cũ: diarization_only (giữ nguyên)
    ...
```

**Thêm argument CLI:**
```
--channels-json  JSON string list [{inputPath, normalizedPath, userId}]
```

**File Python cần tạo / sửa:**
- `transcribe_pipeline.py` — thêm nhánh channel_zone, thêm arg `--channels-json`
- `overlap_detector.py` — thêm function `detect_overlaps_from_segments()` nhận segments thay vì turns
- `merge_segments.py` — thêm function `build_detected_speakers()` hỗ trợ channel_zone source

### Output shape không thay đổi
Kết quả vẫn theo đúng `TranscriptionResult` interface hiện tại. Không cần sửa DB hay service phía sau.

---

## Giai Đoạn 4 — WebSocket Notification Khi Transcript Xong

**Mục đích:** FE nhận tín hiệu ngay khi transcript chuyển sang `DRAFT`.

### Thay đổi trong `TranscriptionWorkerProcessor`
- Sau `backgroundJobsService.markCompleted()`, emit WebSocket event qua Gateway.
- Event name: `transcript.ready`
- Payload: `{ transcriptId, meetingId, status: 'draft' }`
- Inject `EventsGateway` (hoặc tên Gateway có sẵn trong project) vào processor.
- Emit tới room `meeting:{meetingId}` nếu Gateway dùng room-based broadcast.

### Điều kiện tiên quyết
- Cần biết tên WebSocket Gateway hiện tại của project và cơ chế room join.
- Kiểm tra `src/modules/` có gateway nào chưa trước khi làm.

---

## Giai Đoạn 5 — API Kiểm Tra Trạng Thái Job

**Mục đích:** Client poll trạng thái job để hiển thị progress mà không cần gọi GET transcript.

### Endpoint mới
```
GET /api/v1/meetings/:meetingId/transcription-jobs
Authorization: Bearer <JWT>
Response: danh sách job của meeting (mới nhất trước)
```

### Response shape
```json
{
  "success": true,
  "data": [
    {
      "jobId": "uuid",
      "transcriptId": "uuid",
      "status": "completed",
      "transcriptStatus": "draft",
      "createdAt": "...",
      "completedAt": "..."
    }
  ]
}
```

### Logic
- Query `BackgroundJobEntity` theo `relatedEntityType='meeting'` và `relatedEntityId=meetingId`.
- Join với `TranscriptEntity` qua `backgroundJobId` để lấy `transcriptStatus`.
- Check quyền: user phải là participant hoặc Admin.

### File cần sửa
- `capstone-be/src/modules/transcription/transcription.controller.ts` — thêm GET endpoint
- `capstone-be/src/modules/transcription/transcription.service.ts` — thêm method `getTranscriptionJobs()`

---

## Thứ Tự Thực Hiện

```
[1] Giai đoạn 1 (Audio upload API + migration)
        │
        ▼
[2] Giai đoạn 2 (Job multi-channel payload)
        │
        ▼
[3] Giai đoạn 3 (AI Worker + Python channel_zone) ← Làm trước, test riêng
        │
        ├──→ [4] Giai đoạn 4 (WebSocket) — làm song song sau khi [3] xong
        │
        └──→ [5] Giai đoạn 5 (Job status API) — làm song song sau khi [3] xong
```

---

## Ước Tính Thời Gian

| Giai đoạn | Độ phức tạp | Ước tính |
|---|---|---|
| 1 — Audio upload API + migration | Thấp | 0.5 ngày |
| 2 — Job multi-channel payload | Thấp | 0.5 ngày |
| 3 — Python pipeline channel_zone | **Cao** | 2–3 ngày |
| 4 — WebSocket notification | Thấp | 0.5 ngày |
| 5 — Job status API | Thấp | 0.5 ngày |
| **Tổng** | | **~4–5 ngày** |

---

## Các File Chính Cần Đọc Trước Khi Làm

| File | Lý do |
|---|---|
| `src/modules/recording/entities/media-file.entity.ts` | Cần thêm `channelUserId` |
| `src/modules/recording/recording.service.ts` | Thêm upload method |
| `src/modules/transcription/transcription.service.ts` | Sửa findOne → find, build channels |
| `workers/ai-transcription/src/transcription-job-runner.ts` | Thêm multi-channel download |
| `workers/ai-transcription/python/transcribe_pipeline.py` | Thêm channel_zone mode |
| `workers/ai-transcription/python/overlap_detector.py` | Thêm detect từ segments |
| `workers/ai-transcription/python/merge_segments.py` | Thêm build_detected_speakers channel_zone |
| `src/modules/transcription/transcription-worker.processor.ts` | Thêm WebSocket emit |
| `src/modules/transcription/transcription.controller.ts` | Thêm GET jobs endpoint |

---

## Lưu Ý Quan Trọng Khi Implement

1. **Migration `channelUserId`** — cột nullable, không ảnh hưởng data cũ.
2. **Backward-compatible** — nếu job payload không có `channels` array (job cũ), AI Worker fallback về mode cũ (1 file, diarization_only).
3. **Python channel_zone test riêng** — viết unit test cho hàm merge segments trước khi tích hợp vào pipeline.
4. **Cleanup temp dir** — AI Worker đã có `finally { fs.rmSync(jobDir) }`, đảm bảo cleanup cả sub-folder per-channel.
5. **Permission `recording.upload_track`** — cần seed vào DB trước khi test API.
