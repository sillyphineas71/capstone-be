# API Documentation: Speech-to-Text (STT) & AI Summarize

> **Đối tượng đọc:** Frontend team tích hợp 2 luồng lớn — phiên âm cuộc họp (STT) và tóm tắt biên bản bằng AI (AI Summarize).
> **Base URL:** `/api/v1`
> **Trạng thái nguồn:** Toàn bộ endpoint dưới đây đã được xác minh trực tiếp trên code (`src/modules/transcription`, `src/modules/minutes`, `src/modules/administration`) và **đã test thật qua HTTP** (Postgres + Redis + BullMQ + LLM Ollama thật) ngày 2026-07-13/14. Không có endpoint suy đoán.

---

## 📝 CHANGELOG

| Ngày | Tóm tắt |
|---|---|
| 2026-07-14 | Khởi tạo tài liệu API tổng hợp cho STT + AI Summarize, gộp 16 endpoint (6 STT, 3 AI Summarize, 7 Meeting Minutes, 1 shared job-poll) |

---

## 1. Quy ước chung

### 1.1 Auth & Response envelope

- **Auth:** JWT Bearer — `Authorization: Bearer <access_token>`, lấy qua `POST /api/v1/auth/login`.
- **Success:**
  ```json
  { "success": true, "message": "...", "data": {}, "meta": {} }
  ```
- **Error:**
  ```json
  { "success": false, "message": "...", "error": { "code": "SOME_CODE", "details": {} } }
  ```
  (Một số lỗi validation của `ValidationPipe` trả format khác: `{"message": [...], "error": "Bad Request", "statusCode": 400}` — đây là hành vi mặc định của NestJS, không có `error.code`.)
- Toàn bộ ID dùng **UUID v4**. Datetime dùng ISO-8601 (`timestamptz`).

### 1.2 Sơ đồ luồng end-to-end (đã test thật)

```text
1. Recording session kết thúc → có media file audio
2. POST .../transcription-jobs          → 202, jobId (STT)
3. GET /background-jobs/:jobId (poll)   → completed → transcriptId
4. GET .../transcript                    → xem nội dung STT (status=draft)
   [tuỳ chọn] PATCH /transcripts/:id/segments | /content | /status  → sửa tay / duyệt
5. GET .../minutes/ai-draft-config        → kiểm tra tính năng AI có bật không
6. POST .../minutes/ai-draft-jobs         → 202, jobId (AI) — cần transcriptId ở bước 3
7. GET /background-jobs/:jobId (poll)     → completed → minutesId
8. GET /meeting-minutes/:minutesId        → xem bản nháp AI (aiSummary, decisions, actionItems)
   PATCH /meeting-minutes/:minutesId      → sửa tay, giữ nguyên confidence/evidence/meta
9. POST /meeting-minutes/:minutesId/issue → ban hành chính thức (draft → published)
```

`GET /api/v1/background-jobs/:id` dùng CHUNG cho cả job STT lẫn job AI (đọc bảng `background_jobs`, phân biệt bằng field `jobType` client tự biết từ bước tạo).

---

## 2. Phần A — Speech-to-Text (STT / Transcription)

Module: `src/modules/transcription`. Permission node: `transcript.create`, `transcript.read`, `transcript.update`.

### A.1 Tạo job phiên âm

`POST /api/v1/meetings/:meetingId/transcription-jobs` — **202 Accepted**
Permission: `transcript.create` · Auth: Host của meeting hoặc Admin (`BUSINESS_ADMIN`/`SYSTEM_ADMIN`)

Request body (`CreateTranscriptionJobDto`):

| Field | Type | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `recordingSessionId` | uuid | Có | — | Recording session nguồn |
| `language` | string | Không | `vi-VN` | |
| `speakerMappingMode` | `channel_zone \| diarization_only` | Không | tự chọn theo số file audio (1 file → `diarization_only`, nhiều file → `channel_zone`) | |
| `forceRerun` | boolean | Không | `false` | Cho phép tạo job mới dù đang có job `processing` |
| `initialPrompt` | string (≤1000) | Không | — | Custom vocabulary gợi ý cho Whisper |

Response `data`:
```json
{ "jobId": "uuid", "meetingId": "uuid", "status": "queued", "transcriptStatus": "processing" }
```

Lỗi: `400` validation · `401` · `403` `PERMISSION_DENIED` / `TRANSCRIPTION_DISABLED` (flag `TRANSCRIPTION_ENABLED` tắt) · `404` `MEETING_NOT_FOUND` / `RECORDING_SESSION_NOT_FOUND` / `SOURCE_MEDIA_NOT_FOUND` · `409` `TRANSCRIPTION_JOB_ALREADY_RUNNING`.

### A.2 Danh sách job phiên âm theo meeting

`GET /api/v1/meetings/:meetingId/transcription-jobs` — **200**
Permission: `transcript.read` · Auth: participant của meeting hoặc Admin

Response `data` (mảng, sort `completed_at DESC NULLS LAST, started_at DESC NULLS LAST`):
```json
[{
  "jobId": "uuid", "transcriptId": "uuid|null", "status": "completed",
  "transcriptStatus": "draft|null", "createdAt": "ts|null", "completedAt": "ts|null"
}]
```
Lỗi: `401` · `403` `PERMISSION_DENIED` · `404` `MEETING_NOT_FOUND`.

### A.3 Xem transcript của meeting

`GET /api/v1/meetings/:meetingId/transcript` — **200**
Permission: `transcript.read` · Auth: participant hoặc Admin

Query: `includeSegments` (bool, default false) · `page` (default 1) · `limit` (default 50, max 100) — chỉ áp dụng khi `includeSegments=true`.

Response `data`:
```json
{
  "transcriptId": "uuid", "meetingId": "uuid", "status": "draft",
  "language": "vi-VN", "versionNo": 1, "confidenceScore": 0.92,
  "cleanedText": "string|null",
  "segments": [{
    "segmentId": "seg-0001", "startMs": 0, "endMs": 4200,
    "speakerLabel": "SPEAKER_00", "userId": "uuid|null", "channelId": "string|null",
    "roomZoneLabel": "string|null", "text": "...", "confidence": 0.9,
    "overlap": false, "lowConfidence": false, "manualReviewRequired": false,
    "absoluteStartAt": "2026-07-13T09:00:00.000+07:00 | null",
    "absoluteEndAt": "2026-07-13T09:00:04.200+07:00 | null"
  }],
  "generatedAt": "ts"
}
```
`meta` (chỉ có khi `includeSegments=true`): `{ page, limit, total }`.
Lấy transcript **mới nhất** của meeting (sort `createdAt DESC, versionNo DESC` — không phải theo `transcriptId` cụ thể).
Lỗi: `401` · `403` `PERMISSION_DENIED` · `404` `MEETING_NOT_FOUND` / `TRANSCRIPT_NOT_FOUND`.

### A.4 Sửa tay segment

`PATCH /api/v1/transcripts/:transcriptId/segments` — **200**
Permission: `transcript.update` · Auth: **chỉ Host của meeting hoặc Admin** (nghiêm hơn quyền xem)

Request (`UpdateTranscriptSegmentsDto`):
```json
{
  "segments": [{ "segmentId": "seg-0001", "text": "...", "speakerLabel": "...", "speakerUserId": "uuid", "reason": "..." }],
  "revisionNote": "string (≤500)"
}
```
Chỉ field nào truyền mới bị ghi đè trong từng segment (`text`/`speakerLabel`/`speakerUserId` optional). Validate **tất cả** `segmentId` tồn tại trước khi sửa (all-or-nothing). Sửa `speakerUserId` → set `speakerSource='manual'`. **Không đổi `status`** transcript (giữ `draft`).

Response `data`: `{ transcriptId, revisionNo, updatedSegments: string[], editedBy, updatedAt }`
Lỗi: `400` · `401` · `403` `PERMISSION_DENIED` · `404` `TRANSCRIPT_NOT_FOUND` / `SEGMENT_NOT_FOUND`.

### A.5 Ghi đè nội dung transcript (raw/cleaned text)

`PATCH /api/v1/transcripts/:transcriptId/content` — **200**
Permission: `transcript.update` · Auth: Host/Admin (giống A.4)

Request (`UpdateTranscriptContentDto`, ít nhất 1 trong 2 field):
```json
{ "rawText": "string (≤200000)", "cleanedText": "string (≤200000)", "revisionNote": "string (≤500)" }
```
> Đây là nguồn text mà **AI Summarize thật sự đọc** (`cleanedText || rawText`) — dùng để test AI với input tự soạn hoặc sửa khi STT sai nhiều. Không đổi `status`.

Response `data`: `{ transcriptId, editedBy, updatedAt }`
Lỗi: `400` `VALIDATION_ERROR` (thiếu cả 2 field) · `401` · `403` · `404` `TRANSCRIPT_NOT_FOUND`.

### A.6 Chuyển trạng thái transcript (draft → reviewed → approved)

`PATCH /api/v1/transcripts/:transcriptId/status` — **200**
Permission: `transcript.update` · Auth: Host/Admin

Request: `{ "status": "reviewed" | "approved", "note": "string (≤500)" }`

Chuyển hợp lệ: `draft → reviewed`, `draft → approved`, `reviewed → approved`. **Không cho lùi lại**, không set được `processing`/`failed`/`hidden` (hệ thống tự quản lý). `approved` ghi thêm `approvedBy`/`approvedAt`.

Response `data`: `{ transcriptId, status, updatedAt }`
Lỗi: `400` · `401` · `403` · `404` `TRANSCRIPT_NOT_FOUND` · `409` `INVALID_TRANSCRIPT_STATUS_TRANSITION`.

### A.7 Trạng thái transcript (enum tham khảo)

`status`: `processing → draft → reviewed → approved` (hoặc `failed`, `hidden`). **AI Summarize chấp nhận transcript ở `draft`/`reviewed`/`approved`** (không bắt buộc phải `approved` trước).
`securityStatus`: `pending_scan | safe | restricted | blocked` — `restricted`/`blocked` bị AI Summarize từ chối.

---

## 3. Phần B — AI Summarize (AI Meeting Minutes Draft)

Module: `src/modules/minutes` (`ai/`, `services/minutes-ai-draft.service.ts`, `processors/`, `controllers/minutes-ai-draft.controller.ts`). Permission node: `meeting.minutes.ai_draft.create` (chỉ cần cho B.1; B.2/B.3 chỉ cần đăng nhập + ownership).

### B.1 Tạo AI draft job

`POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` — **202 Accepted**
Permission: `meeting.minutes.ai_draft.create` · Auth: **chỉ Host của meeting hoặc `SYSTEM_ADMIN`** (không phải `BUSINESS_ADMIN`)

Request (`CreateAiDraftJobDto`):

| Field | Type | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|---|
| `transcriptId` | uuid | Có | — | Transcript nguồn, phải thuộc đúng `meetingId` |
| `language` | `vi-VN` | Không | `vi-VN` | MVP chỉ hỗ trợ tiếng Việt |
| `forceRerun` | boolean | Không | `false` | Ghi đè bản nháp AI cũ (chỉ khi hiện tại vẫn là AI-draft, `status=draft`) |

Response `data`:
```json
{ "jobId": "uuid", "meetingId": "uuid", "status": "queued" }
```

**Thứ tự validate cố định** (để FE dự đoán lỗi chính xác): meeting tồn tại → ownership → feature flag → transcript hợp lệ (tồn tại/thuộc meeting/status ready/security không restricted) → dedup job đang chạy → quy tắc 1 minutes/meeting.

Lỗi (đã test thật từng mã):
| HTTP | code | Khi nào |
|---|---|---|
| 400 | validation | `transcriptId` sai UUID |
| 401 | — | Chưa đăng nhập |
| 403 | `PERMISSION_DENIED` | Không phải Host và không phải SYSTEM_ADMIN |
| 403 | `AI_SUMMARY_DISABLED` | Feature flag tắt (`system_configs['ai.minutes_summary'].enabled=false`) |
| 403 | `TRANSCRIPT_RESTRICTED` | Transcript có `securityStatus ∈ {restricted, blocked}` |
| 404 | `MEETING_NOT_FOUND` | |
| 404 | `TRANSCRIPT_NOT_FOUND` | Không thuộc meeting |
| 409 | `MINUTES_ALREADY_EXISTS` | Đã có minutes active, `forceRerun=false` |
| 409 | `MINUTES_NOT_AI_DRAFT` | `forceRerun=true` nhưng minutes hiện tại KHÔNG phải AI-draft (soạn tay/đã published) |
| 409 | `AI_JOB_ALREADY_RUNNING` | Đã có job `queued/running/retrying` cho meeting này |
| 422 | `TRANSCRIPT_NOT_READY` | Transcript chưa ở `draft/reviewed/approved` |
| 500 | `ENQUEUE_FAILED` | Lỗi đẩy job vào queue (hiếm) |

Kết quả job (đọc qua B.5/`GET /background-jobs/:jobId`), field `error_message` khi `failed`:
`LLM_UNAVAILABLE` (timeout/lỗi mạng, retry tối đa 1 lần) · `AI_OUTPUT_INVALID_SCHEMA` (LLM trả sai schema sau 1 lần repair-prompt) · `TRANSCRIPT_TOO_LONG_FOR_MVP` (vượt `maxInputTokens`).

### B.2 Resume theo dõi — danh sách AI job theo meeting

`GET /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` — **200**
Auth: Host của meeting HOẶC Admin (`SYSTEM_ADMIN`/`BUSINESS_ADMIN`) — **dùng để FE lấy lại `jobId` sau khi reload trang**, không cần nhớ `jobId` từ response B.1.

Response `data` (mảng, sort `COALESCE(completed_at, started_at, scheduled_at) DESC NULLS FIRST` — job mới nhất/đang chạy luôn ở đầu):
```json
[{
  "jobId": "uuid", "status": "completed",
  "scheduledAt": null, "startedAt": "ts", "completedAt": "ts",
  "errorMessage": null,
  "result": { "status": "draft", "meetingId": "uuid", "minutesId": "uuid" }
}]
```
`data: []` nếu meeting chưa từng chạy AI job (không phải lỗi).
Lỗi: `401` · `403` `PERMISSION_DENIED` · `404` `MEETING_NOT_FOUND`.

### B.3 Trạng thái khả dụng của tính năng (feature flag)

`GET /api/v1/meetings/:meetingId/minutes/ai-draft-config` — **200**
Auth: Host của meeting HOẶC Admin — **FE gọi trước để quyết định hiện/ẩn nút "Tạo bằng AI" và banner "cần review"**, tránh bấm-thử-ăn-403.

Response `data`:
```json
{ "enabled": true, "requireHumanReview": true }
```
Luôn `200` (kể cả khi `enabled=false` — đó là trạng thái hợp lệ, không phải lỗi). Fail-safe: thiếu config → `{enabled:false, requireHumanReview:true}`.
Lỗi: `401` · `403` `PERMISSION_DENIED` · `404` `MEETING_NOT_FOUND`.

> Chỉ trả 2 field trên — **cố tình không lộ** `provider`/`modelName`/`maxInputTokens`/`temperature`/`retentionDays`/`logRawTranscript`/`allowExternalProvider` (chi tiết vận hành nội bộ).

---

## 4. Phần C — Meeting Minutes (nơi AI Summarize ghi kết quả)

Module: `src/modules/minutes` (`controllers/minutes.controller.ts`, `minutes-list.controller.ts`). AI Summarize và người dùng thao tác **trên cùng một entity** `meeting_minutes` — cột `ai_summary_json` khác `NULL` đánh dấu nguồn gốc AI.

### C.1 Tạo biên bản nháp thủ công

`POST /api/v1/meetings/:meetingId/minutes` — **201**
Permission: `meeting.minutes.create` · Auth: chỉ Host

Request: `{ "title": "string (≤255, optional)" }`
Response `data`: `{ id, meetingId, title, status:"draft", visibilityLevel, versionNo:1, minutesContent, preparedBy, createdAt, meetingSnapshot }`
Lỗi: `400` · `401` · `403` `NOT_MEETING_HOST` · `404` `MEETING_NOT_FOUND` · `409` `MEETING_HOST_NOT_ASSIGNED` / `MEETING_NOT_STARTED` / `MEETING_CANCELLED` / `MINUTES_ALREADY_EXISTS`.

### C.2 Danh sách biên bản

`GET /api/v1/meeting-minutes` — **200**
Permission: `meeting.minutes.read`

Query: `page` (default 1) · `limit` (default/max **20**) · `status` (`draft|published|archived|all`) · `roomId` · `from`/`to` · `q` (tìm theo title/meeting title/host name) · `sortBy` (`actual_start_time|created_at`) · `sortOrder` (`asc|desc`)

Phạm vi theo role: user thường thấy nháp của chính mình + biên bản `published/archived` của meeting liên quan (là host hoặc participant); Admin thấy toàn bộ (trừ `deleted`).

Response `data[]`: `{ id, title, status, versionNo, createdAt, meeting: {...}, host: {...}, "isAiGenerated": boolean }` — **`isAiGenerated`** để FE gắn badge phân biệt nháp AI/tay.

### C.3 Chi tiết biên bản

`GET /api/v1/meeting-minutes/:id` — **200**
Permission: `meeting.minutes.read`

Response `data`:
```json
{
  "id": "uuid", "meetingId": "uuid", "title": "...", "status": "draft", "versionNo": 3,
  "generalInfo": { "meetingTitle", "actualStartTime", "actualEndTime", "meetingMode", "room": {...}|null, "host": {...}|null, "noteTaker": {...}|null, "attendees": [...] },
  "mainContent": {
    "minutesContent": "string (đoạn tóm tắt)",
    "decisions": [{ "text": "string", "confidence": "high|medium|low|null", "evidence": "string|null", "responsibleUserId": "uuid|null" }] | null,
    "actionItems": [{ "id": "uuid", "task": "string", "owner": "string|null", "assigneeUserId": "uuid|null", "deadline": "string|null", "priority": "low|medium|high", "confidence": "high|medium|low|null" }] | null
  },
  "aiSummary": {
    "keyPoints": ["..."], "risks": ["..."], "openQuestions": ["..."], "uncertainParts": ["..."],
    "meta": { "provider": "self_hosted_llm|mock", "modelName": "...", "promptVersion": "...", "generatedByJobId": "uuid", "generatedAt": "ts" }
  } | null,
  "isAiGenerated": true,
  "relatedResources": { "transcript": {"id","status","versionNo","languageCode"}|null, "recording": {"id","fileName","durationSeconds","mimeType"}|null },
  "attachments": [...],
  "preparedBy": {...}|null, "issuedBy": {...}|null, "issuedAt": "ts|null",
  "approvedBy": {...}|null, "approvedAt": "ts|null",
  "createdAt": "ts", "updatedAt": "ts",
  "permissions": { "canEdit": boolean, "canIssue": boolean }
}
```
`aiSummary`/`isAiGenerated`: chỉ có giá trị khi biên bản có nguồn gốc AI (`ai_summary_json IS NOT NULL`) — **đây là 2 field chính FE cần đọc để hiển thị kết quả AI**.
Lỗi: `401` · `403` `MEETING_MINUTES_ACCESS_DENIED` · `404` `MEETING_MINUTES_NOT_FOUND`.

### C.4 Sửa nội dung biên bản nháp (sửa tay — bao gồm cả sửa tay kết quả AI)

`PATCH /api/v1/meeting-minutes/:id` — **200**
Permission: `meeting.minutes.update` · Auth: chỉ Host/`preparedBy` hoặc Admin, chỉ khi `status=draft`

Request:
```json
{
  "versionNo": 1,
  "title": "string (≤255, optional)",
  "minutesContent": "string (≤20000, optional)",
  "decisionsJson": [{ "text": "string* (≤2000)", "confidence": "high|medium|low", "evidence": "string (≤2000)", "responsibleUserId": "uuid" }],
  "actionItemsJson": [{ "id": "uuid", "task": "string* (≤1000)", "owner": "string (≤255)", "assigneeUserId": "uuid", "deadline": "string (≤255)", "priority": "low|medium|high", "confidence": "high|medium|low" }],
  "aiSummary": { "keyPoints": ["string"], "risks": ["string"], "openQuestions": ["string"], "uncertainParts": ["string"] }
}
```
**Quan trọng cho FE:** dùng `versionNo` làm optimistic lock — luôn lấy `versionNo` mới nhất từ GET detail trước khi PATCH. `decisionsJson`/`actionItemsJson` dùng **cùng schema mà AI sinh ra** — FE có thể gửi lại nguyên object lấy từ C.3 (đã sửa vài field) mà **không mất `confidence`/`evidence`**. `aiSummary` chỉ ghi đè các mảng được gửi; **`meta` (provider/model/generatedAt...) luôn được server giữ nguyên, không thể sửa qua field này**. `ValidationPipe` dùng `forbidNonWhitelisted` — gửi field lạ sẽ bị `400`.

Response `data`: `{ id, meetingId, title, status, versionNo, minutesContent, decisionsJson, actionItemsJson, aiSummaryJson, attendeesSnapshotJson, preparedBy, updatedAt }`
Lỗi: `400` (thiếu field cập nhật `NO_UPDATE_FIELD` / field lạ) · `401` · `403` `NOT_MINUTES_OWNER` · `404` `MINUTES_NOT_FOUND` · `409` `MINUTES_NOT_DRAFT` / `MINUTES_VERSION_CONFLICT` (kèm `error.details.currentData` để FE tự merge/reload).

### C.5 Xoá biên bản nháp

`DELETE /api/v1/meeting-minutes/:id` — **200**
Permission: `meeting.minutes.delete` · Auth: Host/preparedBy hoặc Admin, chỉ khi `status=draft`

Response `data`: `{ deleted: true, minutesId, deletedAt, cascadedAttachmentCount }`
Lỗi: `401` · `403` `NOT_MINUTES_OWNER` · `404` `MINUTES_NOT_FOUND` · `409` `MINUTES_NOT_DRAFT`.

### C.6 Ban hành biên bản chính thức

`POST /api/v1/meeting-minutes/:id/issue` — **200**
Permission: `meeting.minutes.issue` · Auth: Host/preparedBy hoặc Admin

`draft → published`, ghi `issuedBy`/`issuedAt`, gửi notification cho participant. **Áp dụng y hệt cho biên bản do AI tạo** — đây là bước cuối khép kín luồng AI Summarize.

Response `data`: `{ id, meetingId, title, status:"published", versionNo, issuedBy, issuedAt, updatedAt, notifiedParticipantCount }`
Lỗi: `401` · `403` `NOT_MINUTES_OWNER` · `404` `MINUTES_NOT_FOUND` · `409` `MINUTES_NOT_DRAFT` / `MEETING_NOT_COMPLETED`.

### C.7 Đính kèm tài liệu (không liên quan trực tiếp AI, tóm tắt nhanh)

- `POST /api/v1/meeting-minutes/:minutesId/attachments` — 201, `multipart/form-data` field `file`. Permission `meeting.minutes.attachment.create`. Giới hạn: 20MB/file, tối đa 10 file/biên bản, MIME cho phép (pdf/word/excel/powerpoint/png/jpeg). Chỉ khi `status=draft`.
- `GET /api/v1/meeting-minutes/:minutesId/attachments` — 200, permission `meeting.minutes.attachment.read`.
- `DELETE /api/v1/meeting-minutes/:minutesId/attachments/:fileId` — 200, permission `meeting.minutes.attachment.delete`, chỉ Host/preparedBy, chỉ khi `draft`.

### C.8 Tìm biên bản theo nhân sự (không liên quan trực tiếp AI, tóm tắt nhanh)

`GET /api/v1/meeting-minutes/search-by-person?userId=<uuid>&page=&limit=` — 200, permission `meeting.minutes.search_by_person` (Manager/Admin). Manager chỉ thấy biên bản trong phòng ban quản lý.

---

## 5. Phần D — Shared: theo dõi background job

`GET /api/v1/background-jobs/:id` — **200**
Auth: `JwtAuthGuard` (không cần permission riêng) · Authorize: owner (`requestedBy`) hoặc Admin, kiểm tra trong service.

Dùng chung cho **cả STT job lẫn AI Summarize job** (và các loại job khác trong hệ thống).

Response `data`:
```json
{
  "jobId": "uuid", "jobType": "transcription | ai_meeting_summary",
  "status": "queued|scheduled|running|completed|failed|cancelled|retrying",
  "relatedEntityType": "meeting", "relatedEntityId": "uuid",
  "retryCount": 0, "scheduledAt": "ts|null", "startedAt": "ts|null", "completedAt": "ts|null",
  "errorMessage": "string|null (chỉ khi failed)",
  "result": { "...": "output_json, vd { transcriptId, status } hoặc { minutesId, meetingId, status }" } | null,
  "outputFileId": "uuid|null"
}
```
Lỗi: `401` · `403` (không phải owner/admin) · `404`.

---

## 6. Bảng tổng hợp nhanh (16 endpoint)

| # | Method | Path | Feature | Auth (ngoài JWT) |
|---|---|---|---|---|
| A.1 | POST | `/meetings/:meetingId/transcription-jobs` | STT | Host/Admin, perm `transcript.create` |
| A.2 | GET | `/meetings/:meetingId/transcription-jobs` | STT | participant/Admin, perm `transcript.read` |
| A.3 | GET | `/meetings/:meetingId/transcript` | STT | participant/Admin, perm `transcript.read` |
| A.4 | PATCH | `/transcripts/:transcriptId/segments` | STT | Host/Admin, perm `transcript.update` |
| A.5 | PATCH | `/transcripts/:transcriptId/content` | STT | Host/Admin, perm `transcript.update` |
| A.6 | PATCH | `/transcripts/:transcriptId/status` | STT | Host/Admin, perm `transcript.update` |
| B.1 | POST | `/meetings/:meetingId/minutes/ai-draft-jobs` | AI Summarize | Host/SYSTEM_ADMIN, perm `meeting.minutes.ai_draft.create` |
| B.2 | GET | `/meetings/:meetingId/minutes/ai-draft-jobs` | AI Summarize | Host/Admin |
| B.3 | GET | `/meetings/:meetingId/minutes/ai-draft-config` | AI Summarize | Host/Admin |
| C.1 | POST | `/meetings/:meetingId/minutes` | Minutes | Host, perm `meeting.minutes.create` |
| C.2 | GET | `/meeting-minutes` | Minutes | perm `meeting.minutes.read` |
| C.3 | GET | `/meeting-minutes/:id` | Minutes | perm `meeting.minutes.read` |
| C.4 | PATCH | `/meeting-minutes/:id` | Minutes | Host/preparedBy/Admin, perm `meeting.minutes.update` |
| C.5 | DELETE | `/meeting-minutes/:id` | Minutes | Host/preparedBy/Admin, perm `meeting.minutes.delete` |
| C.6 | POST | `/meeting-minutes/:id/issue` | Minutes | Host/preparedBy/Admin, perm `meeting.minutes.issue` |
| D | GET | `/background-jobs/:id` | Shared | owner/Admin |

*(C.7/C.8 — 4 endpoint attachment/search — không liệt kê lại ở đây, xem mục 4.7/4.8.)*

---

## 7. Ghi chú vận hành khi tích hợp

1. **Feature flag AI Summarize**: `system_configs['ai.minutes_summary'].enabled` — kiểm tra qua B.3 trước khi hiện nút, không hard-code ở FE.
2. **Feature flag STT**: env `TRANSCRIPTION_ENABLED` (server-side, không có endpoint đọc — nếu tắt, A.1 trả `403 TRANSCRIPTION_DISABLED`).
3. **Permission cần seed** cho user test: `transcript.create/read/update`, `meeting.minutes.create/read/update/delete/issue/ai_draft.create/attachment.*`.
4. **Provider AI**: `mock` (dev/test, tức thời) hoặc `self_hosted_llm` (Ollama thật, ~30-100s/job tuỳ warm/cold) — đọc qua `configJson.provider`, FE nên hiện loading/progress khi poll job AI vì thời gian xử lý không cố định (không có `estimatedDurationSeconds`).
5. **Trạng thái code**: tính năng AI Summarize hiện là **WIP local, chưa merge vào `dev`** — nhánh FE tích hợp cần đồng bộ khi code được merge.
6. **Migration ledger**: đã xử lý lỗi ledger cũ (`iot_devices` 42P07) ngày 2026-07-13 — `npm run migration:run` giờ chạy sạch trên DB mới.
