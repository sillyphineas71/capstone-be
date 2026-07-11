## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-01 | Tạo tài liệu tổng hợp toàn bộ API endpoint của luồng transcription (recording-config → recording-session → media-files → transcription-jobs → transcript → segments), đối chiếu trực tiếp với source code controller/DTO hiện tại (không chỉ theo `contracts/transcription-api.md` cũ). Mục tiêu: dùng để test thủ công (Postman/curl). | Toàn bộ file (mới) |
| 2026-07-11 | Gap fix: thêm endpoint mới `POST /meetings/{meetingId}/recording-sessions` (tạo audio session rỗng làm điểm neo cho N participant lần lượt upload audio-tracks vào cùng 1 sessionId — trước đây `audio-tracks` yêu cầu `sessionId` có sẵn nhưng không có API nào tạo được session rỗng cho luồng channel_zone thuần upload). Đánh số lại mục 2.4/2.5 → 2.5/2.6, cập nhật bảng tổng hợp mục 6. | Mục "Luồng test đề xuất", mục 2 (mới 2.4), mục 6 (bảng, dòng #7-9 renumber) |
| 2026-07-11 | Nhóm A gap fix (sau chạy thử thật): (1) `GET media-files` nay trả thêm `channelUserId`; (2) thêm `GET /meetings/{meetingId}/recording-sessions` (mục 2.6 mới) để participant tự tìm sessionId thay vì chờ Host relay tay; (3) thêm `PATCH /transcripts/{transcriptId}/status` (mục 5.3 mới) để chuyển draft→reviewed→approved; (4) `endMeeting` nay tự gửi in-app notification `AUDIO_TRACK_UPLOAD_REQUESTED` cho participant khi recording_configs bật `channel_by_zone`. | Mục 2.4 (renumber →2.5), mục 2 (mới 2.7 status), mục 3.1 (channelUserId), mục 5 (mới 5.3), mục 6 (bảng renumber) |

# Tổng hợp API — Luồng Transcription (Recording → Transcription Job → Transcript)

**Nguồn đối chiếu**: source code thật tại thời điểm viết tài liệu:
- `src/modules/recording/controllers/recording-config.controller.ts`
- `src/modules/recording/controllers/recording-session.controller.ts`
- `src/modules/recording/controllers/media-files.controller.ts`
- `src/modules/transcription/transcription.controller.ts`
- `src/modules/transcription/transcript-segments.controller.ts`
- `src/modules/administration/controllers/background-jobs.controller.ts`

**Base URL**: `http://localhost:3000/api/v1` (prefix `api/v1` set ở `src/main.ts`).
**Auth**: tất cả endpoint dưới đây (trừ `secure-download`) yêu cầu header `Authorization: Bearer <access-token>` (JWT lấy từ `POST /api/v1/auth/login`).

> ⚠️ Các endpoint đánh dấu **[MOCK GUARD]** dùng `MockPermissionsGuard` (`canActivate() { return true; }`) — nghĩa là chỉ cần JWT hợp lệ (bất kỳ role nào) là gọi được, permission string chỉ mang tính khai báo, KHÔNG thực sự chặn. Endpoint không đánh dấu thì dùng `PermissionsGuard` thật (chặn theo permission node + business rule Host/Admin trong service).

---

## Luồng test đề xuất (theo đúng thứ tự)

```
1. (Optional) Tạo/xem/sửa recording-config cho meeting
2a. Ghi hình qua camera thật: start-video → stop-video → (media_files tự tạo)
2b. HOẶC test nhanh không cần camera: audio-upload (upload file .wav/.mp3/.m4a có sẵn)
2c. (Optional, multi-speaker) Tạo audio session rỗng (POST recording-sessions) → từng participant tự uploadAudioTrack vào sessionId đó sau khi meeting completed
3. Xem danh sách media-files của meeting để lấy recordingSessionId/mediaFileId
4. POST transcription-jobs (dùng recordingSessionId từ bước 2)
5. Poll GET /background-jobs/:jobId (status: queued → running → completed/failed)
   HOẶC lắng nghe WebSocket room `meeting:{meetingId}` event `transcript.ready`
6. GET transcript (khi status=completed) — dùng includeSegments=true để xem full segment
7. (Optional) PATCH /transcripts/:transcriptId/segments để sửa tay
8. (Optional) GET transcription-jobs để xem lịch sử job của meeting
```

---

## 1. Recording Config

### 1.1. Tạo cấu hình recording — REC-001 **[MOCK GUARD]**

```http
POST /api/v1/meetings/{meetingId}/recording-config
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission (khai báo, không chặn thật): `recording.config.create`

**Body mẫu** (tất cả field optional):
```json
{
  "enableAudio": true,
  "enableVideo": true,
  "enableTranscription": true,
  "videoSourceDeviceId": null,
  "audioSourceMode": "room_mic",
  "autoStart": false,
  "consentRequired": true,
  "retentionDays": 90
}
```

### 1.2. Xem cấu hình recording **[MOCK GUARD]**

```http
GET /api/v1/meetings/{meetingId}/recording-config
Authorization: Bearer <access-token>
```
Permission: `recording.config.read`

### 1.3. Cập nhật một phần cấu hình **[MOCK GUARD]**

```http
PATCH /api/v1/meetings/{meetingId}/recording-config
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission: `recording.config.update`

**Body mẫu** (partial, chỉ gửi field cần đổi):
```json
{
  "enableTranscription": false,
  "retentionDays": 30
}
```

---

## 2. Recording Session (ghi hình / ghi âm)

### 2.1. Bắt đầu ghi hình từ IP camera — REC-002 (UC-111) **[MOCK GUARD]**

```http
POST /api/v1/live-meetings/{meetingId}/recording/start-video
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission: `recording.video.start` | Response: `201`

**Body mẫu**:
```json
{
  "cameraDeviceId": "6b8f7f2e-1c2d-4a3b-9e10-abcdef123456"
}
```
`outputFormat`/`storageProvider` chấp nhận nhưng bị bỏ qua ở v1 (ép cứng mp4 + local/S3 theo `STORAGE_DRIVER`).

**Response 201 mẫu**:
```json
{
  "success": true,
  "message": "Video recording started",
  "data": {
    "recordingSessionId": "9f1e...uuid",
    "sessionType": "video",
    "status": "recording",
    "startedAt": "2026-07-01T10:00:00.000Z",
    "cameraDeviceId": "6b8f7f2e-1c2d-4a3b-9e10-abcdef123456"
  }
}
```
Lỗi đáng chú ý: `502 RECORDING_NO_VIDEO` nếu camera không gửi được dữ liệu trong cửa sổ probe.

### 2.2. Dừng ghi hình — REC-003 (UC-116) **[MOCK GUARD]**

```http
POST /api/v1/live-meetings/{meetingId}/recording/{sessionId}/stop-video
Authorization: Bearer <access-token>
```
Permission: `recording.video.stop` | Response: `200` (đồng bộ, không cần poll thêm)

**Response 200 mẫu** (có capture được file):
```json
{
  "success": true,
  "message": "Video recording stopped",
  "data": {
    "recordingSessionId": "9f1e...uuid",
    "status": "stopped",
    "stoppedAt": "2026-07-01T10:15:00.000Z",
    "durationSeconds": 900,
    "fileSizeBytes": "20480000",
    "mediaFileId": "3a2b...uuid",
    "captured": true
  }
}
```
Nếu file rỗng/không capture được: `captured: false`, `mediaFileId: null`, message `"Đã dừng nhưng không ghi được video"`.

### 2.3. Upload audio thủ công (ad-hoc, để feed transcription khi không có camera thật)

```http
POST /api/v1/meetings/{meetingId}/recording-sessions/audio-upload
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
```
Permission thật: `transcript.create` (dùng `PermissionsGuard` thật, KHÔNG phải mock) | Chỉ Host/Organizer của meeting hoặc Business/System Admin | Response: `201`

**Form-data**:
| Field | Type | Ghi chú |
|---|---|---|
| `file` | File (binary) | `.wav/.mp3/.m4a/...`, giới hạn `STORAGE_MAX_FILE_SIZE` (mặc định 50MB) |

**curl mẫu**:
```bash
curl -X POST "http://localhost:3000/api/v1/meetings/{meetingId}/recording-sessions/audio-upload" \
  -H "Authorization: Bearer <access-token>" \
  -F "file=@sample-meeting-audio.m4a"
```

**Response 201 mẫu**:
```json
{
  "success": true,
  "message": "Audio uploaded — dùng recordingSessionId để tạo transcription job",
  "data": {
    "recordingSessionId": "9f1e...uuid",
    "mediaFileId": "3a2b...uuid",
    "storageKey": "recordings/{meetingId}/xxxx.m4a",
    "durationSeconds": 612
  }
}
```
Lỗi: `400 EMPTY_AUDIO_FILE`, `400 UNSUPPORTED_MEDIA_FORMAT`, `404 MEETING_NOT_FOUND`.

### 2.4. Tạo audio session rỗng (điểm neo cho nhiều participant upload track)

```http
POST /api/v1/meetings/{meetingId}/recording-sessions
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission thật: `transcript.create` (dùng `PermissionsGuard` thật) | Chỉ Host/Organizer của meeting hoặc Business/System Admin | Response: `201`

**Mục đích**: sinh ra `recordingSessionId` làm điểm neo — session này KHÔNG có file/process nào đứng sau (khác `audio-upload` ở mục 2.3, vốn tạo session kèm sẵn 1 file). Dùng `recordingSessionId` trả về để N participant lần lượt gọi mục 2.5 (`audio-tracks`) vào CÙNG session này.

**Body mẫu** (tất cả field optional):
```json
{
  "notes": "Ghi chú tuỳ chọn cho session này"
}
```

**Response 201 mẫu**:
```json
{
  "success": true,
  "message": "Audio session created — dùng recordingSessionId để participant upload audio-tracks",
  "data": {
    "recordingSessionId": "9f1e...uuid",
    "sessionType": "audio",
    "status": "starting",
    "startedAt": "2026-07-11T10:00:00.000Z"
  }
}
```
Lỗi: `404 MEETING_NOT_FOUND`, `403 PERMISSION_DENIED` (không phải Host/Admin).

### 2.5. Upload audio track riêng theo participant (multi-channel, cho `channel_zone` mode)

```http
POST /api/v1/meetings/{meetingId}/recording-sessions/{sessionId}/audio-tracks
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
```
Permission: `recording.upload_track` (guard thật) | **Điều kiện bắt buộc**: `meeting.status = completed` VÀ user gọi phải là `meeting_participants` của đúng meeting đó | Response: `201`

**Form-data**: giống mục 2.3 (`file`).

`sessionId` phải tồn tại trước — lấy từ mục 2.4 (session rỗng, dùng khi muốn multi-track thuần) hoặc từ mục 2.1/2.3 (session đã có sẵn 1 file/video, ít dùng cho luồng multi-track).

**Response 201 mẫu**:
```json
{
  "success": true,
  "message": "Audio track uploaded successfully.",
  "data": {
    "mediaFileId": "4c5d...uuid",
    "storageKey": "recordings/{meetingId}/track-xxx.wav",
    "channelUserId": "<userId của người upload>",
    "durationSeconds": 590
  }
}
```
Lỗi: `400 MEETING_NOT_ENDED` (meeting chưa completed), `403 NOT_A_PARTICIPANT`, `404 RECORDING_SESSION_NOT_FOUND`.

### 2.6. Xem trạng thái phiên ghi (read-only) **[MOCK GUARD]**

```http
GET /api/v1/live-meetings/{meetingId}/recording/{sessionId}/status
Authorization: Bearer <access-token>
```
Permission: `recording.video.status`

**Response 200 mẫu**:
```json
{
  "success": true,
  "message": "Recording status retrieved",
  "data": {
    "recordingSessionId": "9f1e...uuid",
    "meetingId": "meeting-uuid",
    "sessionType": "video",
    "status": "recording",
    "startedAt": "2026-07-01T10:00:00.000Z",
    "stoppedAt": null,
    "live": true,
    "durationSeconds": null,
    "fileSizeBytes": null,
    "hasProcessHandle": true,
    "errorMessage": null,
    "captured": false
  }
}
```

### 2.7. Danh sách recording session của meeting (participant tự tìm sessionId)

```http
GET /api/v1/meetings/{meetingId}/recording-sessions
Authorization: Bearer <access-token>
```
Permission: `transcript.read` (đã seed đủ 4 role gồm EMPLOYEE — `recording.video.status`/`recording.files.read` KHÔNG có cho EMPLOYEE nên không dùng được ở đây) | Bất kỳ participant nào của meeting hoặc Admin | Response: `200`

**Mục đích**: gap fix — trước đây participant không có cách nào tự tìm `recordingSessionId` để gọi mục 2.5 (`audio-tracks`) ngoài việc Host relay tay. Trả TẤT CẢ session (mọi loại: audio/video), mới nhất trước.

**Response 200 mẫu**:
```json
{
  "success": true,
  "message": "Danh sách recording session của meeting",
  "data": [
    {
      "recordingSessionId": "9f1e...uuid",
      "sessionType": "audio",
      "sourceType": "manual_upload",
      "status": "starting",
      "startedAt": "2026-07-11T10:00:00.000Z",
      "stoppedAt": null
    }
  ]
}
```
Lỗi: `404 MEETING_NOT_FOUND`, `403 PERMISSION_DENIED` (không phải participant/Admin).

---

## 3. Media Files

### 3.1. Danh sách media files của meeting — REC-006 (UC-120) **[MOCK GUARD]**

```http
GET /api/v1/meetings/{meetingId}/media-files?page=1&limit=20&fileType=audio,video
Authorization: Bearer <access-token>
```
Permission: `recording.files.read`

Mỗi item trong `data[]` nay có thêm `recordingSessionId` và `channelUserId` (gap fix) — dùng để FE lọc theo session và biết ai đã upload track nào (progress UI cho `channel_zone`). `channelUserId` là `null` với file không thuộc luồng multi-track (ví dụ video từ camera, hoặc audio-upload gộp 1 file).

### 3.2. Chi tiết 1 media file — (UC-121) **[MOCK GUARD]**

```http
GET /api/v1/media-files/{fileId}
Authorization: Bearer <access-token>
```
Permission: `recording.files.read`

### 3.3. Stream playback (hỗ trợ HTTP Range) — (UC-122) **[MOCK GUARD]**

```http
GET /api/v1/media-files/{fileId}/playback
Authorization: Bearer <access-token>
Range: bytes=0-1023   # optional, cho phép seek
```
Permission: `recording.files.play`. Trả `206 Partial Content` nếu có header `Range`, ngược lại `200` full file.

### 3.4. Ẩn / xoá mềm media file — (UC-123) **[MOCK GUARD]**

```http
PATCH /api/v1/media-files/{fileId}/visibility
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission: `recording.files.manage`

**Body mẫu**:
```json
{
  "action": "hide",
  "reason": "Trùng file, đã upload lại bản đúng"
}
```
`action` chỉ nhận `"hide"` hoặc `"soft_delete"`.

### 3.5. Secure download qua signed token (không dùng JWT)

```http
GET /api/v1/media-files/{fileId}/secure-download?token=<signed-token>
```
Không có `JwtAuthGuard` — xác thực bằng HMAC token do `StorageService.verifySignedDownloadToken` tạo/verify riêng (dùng cho luồng khác như avatar review, không phải luồng transcription chính).

---

## 4. Transcription Jobs

### 4.1. Tạo transcription job — UC-125

```http
POST /api/v1/meetings/{meetingId}/transcription-jobs
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission thật: `transcript.create` + business rule: user phải là Host/Organizer của `meetingId` hoặc `BUSINESS_ADMIN`/`SYSTEM_ADMIN`. Response: `202 Accepted` (async — không trả kết quả transcript ngay).

**Body mẫu**:
```json
{
  "recordingSessionId": "9f1e...uuid",
  "language": "vi-VN",
  "speakerMappingMode": "diarization_only",
  "forceRerun": false,
  "initialPrompt": "Cuộc họp phòng Kinh doanh, các thuật ngữ: KPI, doanh số, upsell"
}
```

| Field | Bắt buộc | Default | Ghi chú |
|---|---|---|---|
| `recordingSessionId` | ✅ | — | Phải thuộc đúng `meetingId` trong path |
| `language` | ❌ | `vi-VN` | |
| `speakerMappingMode` | ❌ | `diarization_only` | `channel_zone` (nhiều audio track/participant) \| `diarization_only` (1 file, tự phân biệt speaker bằng AI) |
| `forceRerun` | ❌ | `false` | Set `true` để tạo job mới dù đang có job `processing` |
| `initialPrompt` | ❌ | — | Max 1000 ký tự, custom vocabulary override cho Whisper |

**Response 202 mẫu**:
```json
{
  "success": true,
  "data": {
    "jobId": "b1c2...uuid",
    "meetingId": "meeting-uuid",
    "status": "queued",
    "transcriptStatus": "processing"
  }
}
```

**Lỗi đáng chú ý**:
| Status | Code |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 403 | `PERMISSION_DENIED` / `TRANSCRIPTION_DISABLED` (`TRANSCRIPTION_ENABLED=false`) |
| 404 | `MEETING_NOT_FOUND` / `RECORDING_SESSION_NOT_FOUND` / `SOURCE_MEDIA_NOT_FOUND` |
| 409 | `TRANSCRIPTION_JOB_ALREADY_RUNNING` (đang có job `processing`, `forceRerun=false`) |

### 4.2. Poll trạng thái job (dùng chung cho mọi loại background job)

```http
GET /api/v1/background-jobs/{jobId}
Authorization: Bearer <access-token>
```
`jobId` = `data.jobId` trả về ở bước 4.1. KHÔNG dùng `PermissionsGuard`, chỉ `JwtAuthGuard` — authorization owner/admin xử lý trong service.

**Response 200 mẫu (đang chạy)**:
```json
{
  "success": true,
  "data": {
    "jobId": "b1c2...uuid",
    "jobType": "transcription",
    "status": "running",
    "relatedEntityType": "meeting",
    "relatedEntityId": "meeting-uuid",
    "retryCount": 0,
    "scheduledAt": null,
    "startedAt": "2026-07-01T10:20:05.000Z",
    "completedAt": null,
    "errorMessage": null,
    "result": null,
    "outputFileId": null
  }
}
```

**Response 200 mẫu (hoàn thành)**:
```json
{
  "success": true,
  "data": {
    "jobId": "b1c2...uuid",
    "jobType": "transcription",
    "status": "completed",
    "relatedEntityType": "meeting",
    "relatedEntityId": "meeting-uuid",
    "retryCount": 0,
    "scheduledAt": null,
    "startedAt": "2026-07-01T10:20:05.000Z",
    "completedAt": "2026-07-01T10:24:40.000Z",
    "errorMessage": null,
    "result": { "transcriptId": "c3d4...uuid", "status": "draft" },
    "outputFileId": null
  }
}
```
`status` có thể là: `queued` → `running` → `completed` | `failed` | `cancelled` | `retrying`. Khi `failed`, xem `errorMessage`.

**Realtime thay thế polling**: BE emit WebSocket event `transcript.ready` vào room `meeting:{meetingId}` khi job xong thành công, payload:
```json
{ "transcriptId": "c3d4...uuid", "meetingId": "meeting-uuid", "status": "draft" }
```
(client cần tự kết nối WebSocket và join room `meeting:{meetingId}` — hiện FE chưa lắng nghe event này).

### 4.3. Danh sách transcription jobs của 1 meeting

```http
GET /api/v1/meetings/{meetingId}/transcription-jobs
Authorization: Bearer <access-token>
```
Permission: `transcript.read`. Trả mảng, mới nhất trước.

**Response 200 mẫu**:
```json
{
  "success": true,
  "data": [
    {
      "jobId": "b1c2...uuid",
      "transcriptId": "c3d4...uuid",
      "status": "completed",
      "transcriptStatus": "draft",
      "createdAt": "2026-07-01T10:19:50.000Z",
      "completedAt": "2026-07-01T10:24:40.000Z"
    }
  ]
}
```

---

## 5. Transcript

### 5.1. Xem transcript cuộc họp — UC-126

```http
GET /api/v1/meetings/{meetingId}/transcript?includeSegments=true&page=1&limit=50
Authorization: Bearer <access-token>
```
Permission: `transcript.read` + business rule: Host/Organizer, participant hợp lệ, hoặc Admin.

**Query params**:
| Param | Default | Ghi chú |
|---|---|---|
| `includeSegments` | `false` | Nếu `false`, không trả `segments[]` (tránh response nặng) |
| `page` | `1` | Chỉ áp dụng khi `includeSegments=true` |
| `limit` | `50` | Max `100` |

**Response 200 mẫu** (khớp `response_result_transcription` ở root repo):
```json
{
  "success": true,
  "data": {
    "transcriptId": "c3d4...uuid",
    "meetingId": "meeting-uuid",
    "status": "draft",
    "language": "vi-VN",
    "versionNo": 1,
    "confidenceScore": 0.53,
    "cleanedText": "Nguyễn Văn A: Bắt đầu cuộc họp...",
    "segments": [
      {
        "segmentId": "seg-0001",
        "startMs": 5000,
        "endMs": 12000,
        "speakerLabel": "unknown",
        "userId": null,
        "channelId": null,
        "roomZoneLabel": null,
        "text": "Chào mọi người, bắt đầu họp nhé.",
        "confidence": 0.61,
        "overlap": false,
        "lowConfidence": false,
        "manualReviewRequired": false
      }
    ],
    "generatedAt": "2026-07-01T10:24:40.000Z"
  },
  "meta": { "page": 1, "limit": 50, "total": 39 }
}
```
`status`: `processing` (đang xử lý, chưa có nội dung) | `draft` (worker vừa xong, chưa review) | `failed`. `reviewed`/`approved`/`hidden` là state hiện có trong enum nhưng chưa có endpoint chuyển trạng thái nào (chỉ update qua sửa segment, không đổi status).

**Lỗi**: `404 TRANSCRIPT_NOT_FOUND` (chưa có transcript nào cho meeting — cần tạo job ở bước 4.1 trước).

### 5.2. Sửa tay segment transcript — UC-127

```http
PATCH /api/v1/transcripts/{transcriptId}/segments
Authorization: Bearer <access-token>
Content-Type: application/json
```
**Lưu ý base path**: `transcripts/...`, KHÔNG phải `meetings/:meetingId/...`. Permission: `transcript.update` + chỉ Host/Organizer của meeting liên quan hoặc Admin.

**Body mẫu**:
```json
{
  "segments": [
    {
      "segmentId": "seg-0001",
      "text": "Chào mọi người, bắt đầu họp thôi.",
      "speakerUserId": "b7e1...uuid",
      "speakerLabel": "Nguyễn Văn A",
      "reason": "Sửa lỗi nhận diện từ"
    }
  ],
  "revisionNote": "Chỉnh sửa lần 1 sau review"
}
```
Chỉ `segmentId` bắt buộc trong mỗi item; `text`/`speakerLabel`/`speakerUserId`/`reason` optional — field nào gửi mới bị ghi đè.

**Response 200 mẫu**:
```json
{
  "success": true,
  "data": {
    "transcriptId": "c3d4...uuid",
    "revisionNo": 2,
    "updatedSegments": ["seg-0001"],
    "editedBy": "<userId>",
    "updatedAt": "2026-07-01T11:00:00.000Z"
  }
}
```
Endpoint này **không** tự đổi `status` sang `reviewed`/`approved` — dùng mục 5.3 bên dưới cho việc đó.

**Lỗi**: `400 VALIDATION_ERROR` (`segments[]` rỗng), `403 PERMISSION_DENIED`, `404 TRANSCRIPT_NOT_FOUND` / `SEGMENT_NOT_FOUND`.

### 5.3. Chuyển trạng thái transcript (draft → reviewed → approved) — gap fix

```http
PATCH /api/v1/transcripts/{transcriptId}/status
Authorization: Bearer <access-token>
Content-Type: application/json
```
Permission: `transcript.update` + chỉ Host/Organizer của meeting liên quan hoặc Admin (giống UC-127).

**Body mẫu**:
```json
{
  "status": "approved",
  "note": "Da review noi dung, chinh xac"
}
```
`status` chỉ nhận `"reviewed"` hoặc `"approved"` (2 trạng thái còn lại — `processing`/`failed`/`hidden` — do hệ thống tự quản lý, không set qua endpoint này). Chỉ cho chuyển **tiến**: `draft → reviewed`, `draft → approved` (bỏ qua reviewed), `reviewed → approved`. Không cho lùi lại `draft`.

**Response 200 mẫu**:
```json
{
  "success": true,
  "data": {
    "transcriptId": "c3d4...uuid",
    "status": "approved",
    "updatedAt": "2026-07-11T12:00:00.000Z"
  }
}
```
Khi chuyển sang `approved`, backend tự set `approved_by`/`approved_at` (cột đã có sẵn trong entity).

**Lỗi**: `400 VALIDATION_ERROR` (`status` không hợp lệ), `403 PERMISSION_DENIED`, `404 TRANSCRIPT_NOT_FOUND`, `409 INVALID_TRANSCRIPT_STATUS_TRANSITION` (ví dụ transcript đang `processing`, hoặc cố lùi từ `approved` về `reviewed`).

---

## 6. Bảng tổng hợp nhanh (copy-paste test)

| # | Method | Path | Permission | Guard thật? |
|---|---|---|---|---|
| 1 | POST | `/meetings/{meetingId}/recording-config` | `recording.config.create` | ❌ Mock |
| 2 | GET | `/meetings/{meetingId}/recording-config` | `recording.config.read` | ❌ Mock |
| 3 | PATCH | `/meetings/{meetingId}/recording-config` | `recording.config.update` | ❌ Mock |
| 4 | POST | `/live-meetings/{meetingId}/recording/start-video` | `recording.video.start` | ❌ Mock |
| 5 | POST | `/live-meetings/{meetingId}/recording/{sessionId}/stop-video` | `recording.video.stop` | ❌ Mock |
| 6 | GET | `/live-meetings/{meetingId}/recording/{sessionId}/status` | `recording.video.status` | ❌ Mock |
| 7 | POST | `/meetings/{meetingId}/recording-sessions/audio-upload` | `transcript.create` | ✅ Thật |
| 8 | POST | `/meetings/{meetingId}/recording-sessions` | `transcript.create` | ✅ Thật |
| 9 | POST | `/meetings/{meetingId}/recording-sessions/{sessionId}/audio-tracks` | `recording.upload_track` | ✅ Thật |
| 10 | GET | `/meetings/{meetingId}/recording-sessions` | `transcript.read` | ✅ Thật |
| 11 | GET | `/meetings/{meetingId}/media-files` | `recording.files.read` | ❌ Mock |
| 12 | GET | `/media-files/{fileId}` | `recording.files.read` | ❌ Mock |
| 13 | GET | `/media-files/{fileId}/playback` | `recording.files.play` | ❌ Mock |
| 14 | PATCH | `/media-files/{fileId}/visibility` | `recording.files.manage` | ❌ Mock |
| 15 | GET | `/media-files/{fileId}/secure-download?token=` | (HMAC token, không JWT) | — |
| 16 | POST | `/meetings/{meetingId}/transcription-jobs` | `transcript.create` | ✅ Thật |
| 17 | GET | `/background-jobs/{jobId}` | (chỉ JwtAuthGuard) | ✅ Thật |
| 18 | GET | `/meetings/{meetingId}/transcription-jobs` | `transcript.read` | ✅ Thật |
| 19 | GET | `/meetings/{meetingId}/transcript` | `transcript.read` | ✅ Thật |
| 20 | PATCH | `/transcripts/{transcriptId}/segments` | `transcript.update` | ✅ Thật |
| 21 | PATCH | `/transcripts/{transcriptId}/status` | `transcript.update` | ✅ Thật |

Tất cả path phía trên cần prefix `http://localhost:3000/api/v1` khi test.
