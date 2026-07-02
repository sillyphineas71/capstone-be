## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo contract ban đầu, đối chiếu trực tiếp với `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 13 (UC-125, UC-126, UC-127, UC-128). | Toàn bộ file (mới) |

# Contract: Meeting Transcription Management

**Nguồn chuẩn**: `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 13. Contract này KHÔNG tự bịa endpoint mới — chỉ trích dẫn lại đúng UC đã có và ghi rõ phần nào áp dụng/không áp dụng cho kiến trúc AI Worker nội bộ của feature `feat-offline-local-transcription-pipeline`.

**Module**: `transcription` | **Tables**: `transcripts`, `recording_sessions`, `background_jobs`, `media_files`
**System Roles**: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

---

## UC-125 — Tạo transcription job (Chuyển giọng nói thành văn bản)

```http
POST /api/v1/meetings/{meetingId}/transcription-jobs
Content-Type: application/json
Authorization: Bearer <access-token>
```

- **Permission**: `transcript.create`
- **Business rule bổ sung (ngoài permission node)**: user phải là Host/Organizer của đúng `meetingId`, hoặc có role `BUSINESS_ADMIN`/`SYSTEM_ADMIN` (xem `spec.md` FR-034). Participant thường KHÔNG được gọi endpoint này trong MVP.
- **Async**: Yes (kết quả xử lý đến qua BullMQ + AI Worker, không trả ngay trong response)

### Request Body

```json
{
  "recordingSessionId": "uuid",
  "language": "vi-VN",
  "speakerMappingMode": "channel_zone",
  "forceRerun": false
}
```

| Field | Type | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `recordingSessionId` | `uuid` | Có | — | Phải thuộc `meetingId` trong path |
| `language` | `string` | Không | `vi-VN` | Mã ngôn ngữ hỗ trợ |
| `speakerMappingMode` | `enum` | Không | `diarization_only` | `channel_zone` \| `diarization_only` |
| `forceRerun` | `boolean` | Không | `false` | — |

### Response 202

```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "meetingId": "uuid",
    "status": "queued",
    "transcriptStatus": "processing",
    "estimatedCompletion": "2026-06-10T11:30:00+07:00"
  }
}
```

### Error Responses

| Status | Code | Khi nào |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Thiếu/sai `recordingSessionId`, `language`, `speakerMappingMode` |
| `401` | `Unauthorized` | Thiếu/sai JWT |
| `403` | `PERMISSION_DENIED` | Không có `transcript.create`, hoặc không phải Host/Admin của meeting |
| `403` | `TRANSCRIPTION_DISABLED` | `TRANSCRIPTION_ENABLED=false` |
| `404` | `MEETING_NOT_FOUND` | Meeting không tồn tại |
| `404` | `RECORDING_SESSION_NOT_FOUND` | Recording session không thuộc meeting |
| `404` | `SOURCE_MEDIA_NOT_FOUND` | Không có media file audio active hợp lệ |
| `409` | `TRANSCRIPTION_JOB_ALREADY_RUNNING` | Đã có job `processing` cho recording session, `forceRerun=false` |
| `500` | `SYSTEM_ERROR` | Lỗi DB/internal khác |

---

## UC-126 — Xem transcript cuộc họp

```http
GET /api/v1/meetings/{meetingId}/transcript?includeSegments=true&page=1&limit=50
Authorization: Bearer <access-token>
```

- **Permission**: `transcript.read`
- **Business rule bổ sung**: user phải là Host/Organizer, hoặc là `meeting_participants` hợp lệ của đúng `meetingId`, hoặc có role `BUSINESS_ADMIN`/`SYSTEM_ADMIN` (xem `spec.md` FR-036). Không leak transcript của meeting khác.
- **Async**: No

### Query Parameters

| Param | Type | Default | Ghi chú |
|---|---|---|---|
| `includeSegments` | `boolean` | `false` | Nếu `false`, KHÔNG trả full segment JSON (tránh response quá nặng) |
| `page` | `integer` | `1` | Chỉ áp dụng khi `includeSegments=true` |
| `limit` | `integer` | `50` | Max `100` |

### Response 200

```json
{
  "success": true,
  "data": {
    "transcriptId": "uuid",
    "meetingId": "uuid",
    "status": "draft",
    "language": "vi-VN",
    "versionNo": 1,
    "confidenceScore": 0.89,
    "cleanedText": "Nguyễn Văn A: Bắt đầu cuộc họp...",
    "segments": [
      {
        "segmentId": "seg-001",
        "startMs": 5000,
        "endMs": 12000,
        "speakerLabel": "Speaker_1",
        "userId": null,
        "channelId": "CH01",
        "roomZoneLabel": "Góc A",
        "text": "Chào mọi người, bắt đầu họp nhé.",
        "confidence": 0.95
      }
    ],
    "generatedAt": "2026-06-10T11:15:00+07:00"
  },
  "meta": { "page": 1, "limit": 50, "total": 120 }
}
```

> **Ghi chú quan trọng**: `status` trả về trong phạm vi feature này CHỈ là `processing`/`draft`/`failed`. Giá trị `reviewed`/`approved`/`hidden` thuộc một luồng review thủ công khác, ngoài scope (xem `spec.md` mục 8).

### Error Responses

| Status | Code | Khi nào |
|---|---|---|
| `401` | `Unauthorized` | Thiếu/sai JWT |
| `403` | `PERMISSION_DENIED` | Không có `transcript.read`, hoặc không phải participant/Host/Admin hợp lệ |
| `404` | `MEETING_NOT_FOUND` | Meeting không tồn tại |
| `404` | `TRANSCRIPT_NOT_FOUND` | Chưa có transcript nào cho meeting |

---

## UC-127 — Chỉnh sửa transcript thủ công

```http
PATCH /api/v1/transcripts/{transcriptId}/segments
Content-Type: application/json
Authorization: Bearer <access-token>
```

- **Permission**: `transcript.update`
- **Business rule bổ sung**: chỉ Host/Organizer của meeting liên quan, hoặc `BUSINESS_ADMIN`/`SYSTEM_ADMIN`. Participant thường KHÔNG được sửa transcript trong MVP (nghiêm ngặt hơn quyền xem — xem `spec.md` FR-038, `AGENTS.md` mục 20.2).
- **Async**: No

### Request Body

```json
{
  "segments": [
    {
      "segmentId": "seg-001",
      "text": "Chào mọi người, bắt đầu họp thôi.",
      "speakerUserId": "uuid",
      "speakerLabel": "Nguyễn Văn A",
      "reason": "Sửa lỗi nhận diện từ"
    }
  ],
  "revisionNote": "Chỉnh sửa lần 1 sau review"
}
```

### Response 200

```json
{
  "success": true,
  "data": {
    "transcriptId": "uuid",
    "revisionNo": 2,
    "updatedSegments": ["seg-001"],
    "editedBy": "uuid",
    "updatedAt": "2026-06-03T10:00:00+07:00"
  }
}
```

> **Ghi chú quan trọng**: endpoint này chỉ sửa nội dung segment (text/speaker label do người dùng chỉnh tay), **không** tự động đổi `transcripts.status` sang `reviewed`/`approved`. Luồng approve chính thức là out of scope (CLR-002 trong `spec.md`).

### Error Responses

| Status | Code | Khi nào |
|---|---|---|
| `400` | `VALIDATION_ERROR` | `segments[]` rỗng hoặc thiếu `segmentId` |
| `401` | `Unauthorized` | Thiếu/sai JWT |
| `403` | `PERMISSION_DENIED` | Không có `transcript.update`, hoặc không phải Host/Admin |
| `404` | `TRANSCRIPT_NOT_FOUND` | `transcriptId` không tồn tại |
| `404` | `SEGMENT_NOT_FOUND` | `segmentId` không tồn tại trong transcript |

---

## Background Job Status (reuse, không tạo route mới)

Theo `AGENTS.md` mục 22.13, dùng lại endpoint background job hiện có (`GET /api/v1/background-jobs/{jobId}`) để client poll trạng thái job thay vì tạo route riêng cho transcription. Status trả về theo `BackgroundJobStatus` enum đã có: `queued` → `running` → `completed` | `failed` | `cancelled` | `retrying`.

---

## UC-128 — Bảo mật xử lý dữ liệu Speech-to-Text

### 128a. Cấu hình bảo mật STT (giữ nguyên, áp dụng cho feature này)

```http
PUT /api/v1/system-configs/transcription-security
```

- **Permission**: `system.config.transcription.update` | **System Role**: `SYSTEM_ADMIN`

```json
{
  "configKey": "transcription.security",
  "configJson": {
    "retentionDays": 90,
    "encryptAtRest": true,
    "deleteRawAudioAfterTranscription": false,
    "externalProvider": "internal_only",
    "accessRules": ["host", "admin"]
  },
  "versionNo": 1
}
```

`"externalProvider": "internal_only"` chính là cách config này diễn đạt đúng quyết định bảo mật đã chốt của feature: **không** dùng cloud STT/API ngoài (`spec.md` NFR-004).

### 128b. Callback từ STT provider — **KHÔNG áp dụng cho feature này**

```http
POST /api/v1/internal/transcription/callbacks
```

- **Permission**: `internal.service.transcription.callback` | **System Role**: `INTERNAL_SERVICE`

> **Deviation đã ghi nhận (CLR-001 trong `spec.md`)**: UC-128b mô tả mô hình một STT provider **bên ngoài** gọi callback HTTP có HMAC signature (`X-Service-Signature`) về backend để báo kết quả. Kiến trúc của `feat-offline-local-transcription-pipeline` dùng **AI Worker nội bộ** (Node process consume BullMQ trực tiếp, spawn Python child process, viết kết quả vào DB qua service/repository trong cùng codebase backend) — không có service bên ngoài nào cần gọi callback HTTP. Vì vậy endpoint UC-128b **không được implement/sử dụng** trong phạm vi feature này. Endpoint này được giữ nguyên trong API_CONTRACT cho khả năng tích hợp provider ngoài trong tương lai (ngoài scope MVP).

---

## Tổng hợp Permission dùng trong feature này

| Permission | Mô tả | Dùng ở |
|---|---|---|
| `transcript.create` | Tạo transcript | UC-125 |
| `transcript.read` | Xem transcript | UC-126 |
| `transcript.update` | Chỉnh sửa transcript | UC-127 |
| `system.config.transcription.update` | Cập nhật cấu hình STT | UC-128a (ngoài luồng AI Worker, chỉ Admin cấu hình policy) |

**Không có permission nào được thêm mới.** `transcript.approve` không tồn tại trong registry và không được tạo thêm trong feature này (CLR-002).
