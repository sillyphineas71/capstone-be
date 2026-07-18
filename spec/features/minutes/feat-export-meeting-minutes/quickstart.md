# Quickstart: Export Meeting Minutes (UC-147)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo quickstart cho feat-export-meeting-minutes | Toàn bộ file |

- **Target**: `POST /api/v1/meeting-minutes/{id}/exports`
- **Polling**: `GET /api/v1/background-jobs/{jobId}` (đã có sẵn)
- **Download**: `GET /api/v1/media-files/{fileId}` → `downloadUrl` (đã có sẵn)

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Preparer export PDF mặc định | Biên bản `published`, `preparedBy=U`. `U` POST export `{ format: "pdf" }` | 202 + jobId. Sau khi worker xong: `background_jobs.status=completed`, `media_files` mới `fileType=EXPORT`, `meeting_minutes.file_id` được cập nhật |
| 2 | Host (đã thay preparedBy) export | `meeting.hostId=B` khác `preparedBy=A`. `B` POST export | 202 |
| 3 | Business Admin export hộ | Admin `C` POST export cho biên bản của người khác | 202 |
| 4 | Export Word | POST export `{ format: "docx" }` | 202, worker tạo file `.docx` hợp lệ (`mimeType` đúng, buffer không rỗng) |
| 5 | Export tùy biến không ghi đè file_id | POST export `{ format: "docx", includeTranscript: true }` sau khi đã có 1 export mặc định trước đó | `meeting_minutes.file_id` giữ nguyên giá trị của export mặc định trước đó |
| 6 | includeTranscript nhưng không có transcript liên kết | Biên bản có `linkedTranscriptId=NULL`, POST export `{ includeTranscript: true }` | Worker vẫn `completed`, file vẫn tạo được (bỏ qua phần transcript) |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 7 | Unauthenticated | POST export không JWT | 401 |
| 8 | Participant thường | POST export bởi user không phải preparedBy/host/Admin | 403 NOT_MINUTES_OWNER |
| 9 | Thiếu permission | POST export bởi user không có `meeting.minutes.export` | 403 FORBIDDEN |

### Business Rule / State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 10 | Biên bản còn draft | POST export cho biên bản `status=draft` | 409 MINUTES_NOT_PUBLISHED |
| 11 | Biên bản đã archived | POST export cho biên bản `status=archived` | 409 MINUTES_NOT_PUBLISHED |
| 12 | Biên bản không tồn tại | POST export với `id` ngẫu nhiên hợp lệ UUID | 404 MINUTES_NOT_FOUND |
| 13 | Biên bản đã xóa mềm | POST export cho biên bản có `deletedAt` khác NULL | 404 MINUTES_NOT_FOUND |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 14 | `id` không phải UUID | POST export với path param không hợp lệ | 400 |
| 15 | Thiếu `format` | POST export body `{}` | 400 VALIDATION_ERROR |
| 16 | `format` không hợp lệ | POST export `{ format: "xlsx" }` | 400 VALIDATION_ERROR |

### Worker / Job Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 17 | Render lỗi | Giả lập lỗi trong renderer (mock throw) | `background_jobs.status=failed`, `errorMessage` set, worker KHÔNG crash (job tiếp theo trong queue vẫn xử lý bình thường) |
| 18 | Export lặp lại nhiều lần | POST export 3 lần liên tiếp cùng `minutesId` | Mỗi lần tạo 1 `background_jobs`/`media_files` độc lập — không dedupe (gap đã biết, nhất quán `reports`) |

## Verification Notes

- [ ] `background_jobs.job_type = 'export_minutes'` cho mọi job tạo bởi feature này.
- [ ] Queue `minutes-export` (không phải `report-export`) nhận đúng job — verify qua `QueueService`/Redis, không lẫn với job của module `reports`.
- [ ] `media_files.file_type = 'EXPORT'`, `related_entity_type = 'meeting_minutes'`, `related_entity_id = <minutesId>`.
- [ ] `meeting_minutes.file_id` chỉ đổi khi export "mặc định" — verify bằng cách export tùy biến trước, mặc định sau, và ngược lại.
- [ ] `GET /background-jobs/:jobId` và `GET /media-files/:fileId` (2 endpoint đã có sẵn) trả đúng dữ liệu, không cần route mới nào.
- [ ] File PDF/DOCX tải về mở được, không rỗng, chứa đúng nội dung biên bản (title, decisions, action items nếu `includeActionItems=true`).
- [ ] Regression: `feat-issue-meeting-minutes`, `feat-update-draft-meeting-minutes`, `feat-attach-minutes-document` vẫn hoạt động bình thường sau khi thêm route mới vào `MeetingMinutesListController`.
