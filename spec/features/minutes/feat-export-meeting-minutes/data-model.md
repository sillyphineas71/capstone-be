# Data Model: Export Meeting Minutes (UC-147)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo data-model cho feat-export-meeting-minutes | Toàn bộ file |

## 1. Bảng liên quan (không có bảng/cột/enum mới)

### 1.1 `meeting_minutes` (đọc + ghi có điều kiện, entity: `MeetingMinutesEntity`)
| Column | Feature này | Ghi chú |
| :--- | :--- | :--- |
| `id` | Đọc (điều kiện WHERE) | Path param `:id` |
| `meeting_id` | Đọc | Join `meetings` để lấy `hostId` |
| `status` | Đọc | Điều kiện: chỉ export khi `= published` — KHÔNG đổi trạng thái |
| `prepared_by` | Đọc (ownership) | Không đổi |
| `title`, `minutes_content`, `decisions_json`, `action_items_json` | Đọc | Nội dung đưa vào file export |
| `linked_transcript_id` | Đọc (điều kiện `includeTranscript`) | Join `transcripts` nếu khác NULL |
| `file_id` | **Ghi có điều kiện** | Chỉ set khi export là "mặc định" (`format=pdf AND includeTranscript=true AND includeActionItems=true`) — xem FR-006 |

### 1.2 `meetings` (chỉ đọc, entity: `MeetingEntity`)
Đọc `host_id` (ownership check). Không đọc `status` (không có điều kiện `meeting.status` cho export — khác `feat-issue-meeting-minutes` yêu cầu `completed` để publish; export chỉ phụ thuộc `meeting_minutes.status`).

### 1.3 `transcripts` (chỉ đọc có điều kiện, entity: `TranscriptEntity`)
Chỉ đọc khi `includeTranscript=true` AND `meeting_minutes.linkedTranscriptId IS NOT NULL`. Nếu `linkedTranscriptId IS NULL`, bỏ qua bước này (không lỗi, xem FR-011).

### 1.4 `background_jobs` (ghi, entity: `BackgroundJobEntity`)
1 dòng/lần gọi API tạo export job:
| Field | Giá trị |
| :--- | :--- |
| `job_type` | `BackgroundJobType.EXPORT_MINUTES` (`'export_minutes'`, **đã có sẵn** trong enum) |
| `requested_by` | `authUser.userId` |
| `related_entity_type` | `'meeting_minutes'` |
| `related_entity_id` | `<minutesId>` |
| `input_json` | `{ minutesId, format, includeTranscript, includeActionItems }` |
| `status` | `queued` → (worker) `running` → `completed` \| `failed` |
| `output_json` | (worker set khi completed) `{ fileName, format, outputFileId }` |
| `output_file_id` | (worker set khi completed) `<mediaFile.id>` |
| `error_message` | (worker set khi failed) rút gọn |

### 1.5 `media_files` (ghi, entity: `MediaFileEntity`)
1 dòng/job hoàn tất thành công:
| Field | Giá trị |
| :--- | :--- |
| `file_type` | `MediaFileType.EXPORT` (**đã có sẵn** trong enum) |
| `mime_type` | `application/pdf` hoặc `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `storage_provider` | `LOCAL` \| `S3` \| `MINIO` (theo `StorageService.getDriver()`) |
| `storage_key` | Từ `StorageService.saveFile()` |
| `related_entity_type` | `'meeting_minutes'` |
| `related_entity_id` | `<minutesId>` |
| `visibility_level` | `MediaVisibilityLevel.INTERNAL` |
| `is_active` | `true` |

### 1.6 `audit_logs` (ghi khi job thành công, entity: `AuditLogEntity`)
1 dòng/job hoàn tất thành công: `action_type=meeting_minutes_exported`, `entity_type=meeting_minutes`, `entity_id=<minutesId>`, `metadata_json={format, mediaFileId, includeTranscript, includeActionItems}`.

## 2. Thay đổi code cho entity/enum
**Không có** — `meeting_minutes.file_id`, `MediaFileType.EXPORT`, `BackgroundJobType.EXPORT_MINUTES` đều đã tồn tại sẵn trong entity hiện tại, không cần sửa file entity nào. Chỉ cần thêm:
- 1 migration seed permission `meeting.minutes.export`.
- 1 npm dependency `docx`.

## 3. Response Shape (tạo job — 202)
```ts
interface CreateMinutesExportResponseData {
  jobId: string;
  status: 'queued';
  minutesId: string;
  format: 'pdf' | 'docx';
  estimatedCompletion: null;
}
```

## 4. Job Data Shape (BullMQ payload)
```ts
interface MinutesExportJobData {
  backgroundJobId: string;
  minutesId: string;
  format: 'pdf' | 'docx';
  includeTranscript: boolean;
  includeActionItems: boolean;
  requestedByUserId: string;
}
```

## 5. State Diagram
```text
[API request] --(validate: published + ownership-or-admin)--> background_jobs(queued)
background_jobs(queued) --(worker markRunning)--> background_jobs(running)
background_jobs(running) --(render+save thành công)--> background_jobs(completed) + media_files(new row)
background_jobs(running) --(lỗi bất kỳ bước nào)--> background_jobs(failed)

meeting_minutes.file_id:
  NULL hoặc <old-file-id> --(export MẶC ĐỊNH thành công)--> <new-file-id>
  (không đổi nếu export KHÔNG phải mặc định)
```
`meeting_minutes.status` KHÔNG bị feature này thay đổi (export không phải state transition của biên bản, chỉ tạo file phái sinh).

## 6. Không có migration schema
Chỉ có 1 migration seed permission `meeting.minutes.export` (xem plan.md mục 4.2) — không `ALTER TABLE` nào, không sửa entity nào.
