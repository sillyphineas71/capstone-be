## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo spec.md ban đầu, tách từ `docs/Offline Meeting Transcription Pipeline Plan.md` theo cấu trúc Speckit. Bổ sung rõ authorization rules cho create/read/update transcript, security status policy cho MVP, quy tắc draft-không-tự-approve, giới hạn Local MVP chỉ dùng small/medium CPU int8, và xác nhận Production GPU là future target không phải MVP commitment. | Toàn bộ file (mới) |

> File này là tài liệu documentation-first, **chưa code**. Toàn bộ nội dung kế thừa từ `docs/Offline Meeting Transcription Pipeline Plan.md` (đã chốt qua nhiều vòng review) và đối chiếu với `AGENTS.md`, `docs/API_CONTRACT_v1.0_with_system_roles.md` (mục 13 — Meeting Transcription Management), `database_v3_2_compact_39_tables.md`, và code hiện có trong `src/modules/transcription`, `src/modules/recording`, `src/modules/administration`, `src/modules/queue`, `src/modules/storage`.

---

# Feature Specification: Offline Local Meeting Transcription Pipeline

- **Feature ID**: TRANS-OFFLINE-001
- **Feature Name**: Pipeline chuyển giọng nói cuộc họp thành văn bản, chạy offline/self-hosted, có diarization và xử lý overlap cơ bản
- **Module / Domain**: `transcription` (phụ thuộc `recording`, `administration` cho `background_jobs`, `queue`, `storage`)
- **Created Date**: 2026-06-29
- **Status**: Draft
- **Source Documents**:
  - `docs/Offline Meeting Transcription Pipeline Plan.md` (nguồn quyết định chính, đã qua nhiều vòng chốt)
  - `AGENTS.md`
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 13 (UC-125, UC-126, UC-127, UC-128)
  - `database_v3_2_compact_39_tables.md`
  - `src/modules/transcription/entities/transcript.entity.ts`
  - `src/modules/administration/entities/background-job.entity.ts`
  - `src/modules/recording/entities/media-file.entity.ts`, `recording-session.entity.ts`
  - `src/modules/queue/queue.module.ts`, `queue.service.ts`
  - `src/modules/storage/storage.service.ts`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống cần tạo transcript (văn bản hoá nội dung cuộc họp) từ recording audio/video sau khi cuộc họp kết thúc, **chạy hoàn toàn offline/self-hosted trong private network của công ty**, không gửi audio hoặc transcript ra ngoài cho bất kỳ cloud STT/API thứ ba nào. Đây là yêu cầu bảo mật tuyệt đối: nội dung cuộc họp (giọng nói và văn bản) được coi là dữ liệu nội bộ nhạy cảm.

Tính năng thuộc module `transcription`, dùng lại các bảng đã có trong DB Compact: `transcripts`, `background_jobs`, `media_files`, `recording_sessions`. Không thêm bảng mới.

Pipeline phải đáp ứng đồng thời 3 mục tiêu kỹ thuật:
1. Speech-to-text (STT) bằng `faster-whisper`.
2. Diarization/speaker segmentation/overlap detection cơ bản bằng `pyannote.audio`.
3. Xử lý overlapped speech ở mức best-effort bằng `SpeechBrain SepFormer` (chỉ chạy khi phát hiện overlap, không bắt buộc phải chính xác).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host/Organizer cuộc họp hoặc Business Admin/System Admin yêu cầu hệ thống tạo transcript từ recording đã có, để hệ thống tự động chạy STT + diarization + overlap handling trong private network, lưu kết quả vào `transcripts` ở trạng thái `draft` để con người review trước khi coi là chính thức, mà không làm rò rỉ audio/transcript ra ngoài công ty.

### 1.3 Giá trị mang lại

- Cho Host/Organizer: có bản nháp transcript để làm biên bản (`meeting_minutes`) nhanh hơn, không cần nghe lại toàn bộ recording.
- Cho Business Admin/System Admin: kiểm soát được pipeline AI chạy nội bộ, không lệ thuộc nhà cung cấp cloud STT bên ngoài, giảm rủi ro rò rỉ dữ liệu họp.
- Cho bảo mật/vận hành: audio và transcript không bao giờ rời khỏi MinIO private bucket và private network; có audit/log rõ ràng cho từng job xử lý.
- Cho team capstone: có lộ trình triển khai chia milestone (M1-M4), validate được trên laptop dev không có GPU trước khi cần đầu tư hạ tầng GPU thật.

### 1.4 Giả định

- DB Compact hiện có đã đủ cột cần thiết trong `transcripts`, `background_jobs`, `media_files`, `recording_sessions` — đã xác nhận khớp 100% qua code review (`transcript.entity.ts`, `background-job.entity.ts`, `media-file.entity.ts`), không cần migration.
- BullMQ (`QueueModule`, `QueueService`) và queue `transcription` (env `QUEUE_TRANSCRIPTION`, token DI `QUEUE_TRANSCRIPTION_NAME`) đã sẵn sàng, không cần dựng mới.
- MinIO container đã chạy trong `docker-compose.dev.yml`, nhưng `StorageService` (`src/modules/storage/storage.service.ts`) **hiện chỉ có driver `local`**, chưa implement driver MinIO/S3 thật — đây là gap đã xác nhận, cần đóng trước khi AI worker đọc được audio từ MinIO (xem T-STORAGE-001 trong `tasks.md`).
- `TranscriptionModule` (`src/modules/transcription/transcription.module.ts`) hiện chỉ đăng ký `TranscriptEntity`, chưa có controller/service/DTO/processor nào — toàn bộ business logic là phần cần xây mới.
- Pyannote diarization model (`pyannote/speaker-diarization-3.1`, `pyannote/segmentation-3.0`) là gated model trên HuggingFace, cần một người có quyền (assignee cụ thể) accept license và tạo access token READ-only trên máy có internet, trước khi preload vào image/volume — không thực hiện ở runtime container.
- Laptop dev hiện tại để validate Local Development Profile: Intel Core i5-11300H (4 core/8 thread), 16GB RAM, Intel Iris Xe Graphics (không có NVIDIA CUDA). Đây là giới hạn phần cứng đã xác nhận, không phải giả định lạc quan.

### 1.5 Cần làm rõ

- **CLR-001**: API_CONTRACT hiện tại (UC-128b, endpoint `POST /api/v1/internal/transcription/callbacks`, permission `internal.service.transcription.callback`) mô tả mô hình STT provider **ngoài** gọi callback HTTP có HMAC signature về backend. Pipeline trong feature này dùng **AI Worker nội bộ** (Node consume BullMQ + spawn Python child process), viết trực tiếp vào DB qua repository/service nội bộ — **không** cần HTTP callback vì không có service ngoài. UC-128b được giữ nguyên trong API_CONTRACT cho khả năng tích hợp provider ngoài trong tương lai, nhưng **không áp dụng** cho MVP của feature này. Cần team xác nhận lại nếu có ý định dùng UC-128b cho mục đích khác.
- **CLR-002**: Chưa có permission riêng `transcript.approve` trong registry hiện có (chỉ có `transcript.create`, `transcript.read`, `transcript.update`). Trạng thái `approved` tồn tại trong `TranscriptStatus` enum nhưng cơ chế/permission để chuyển `draft` → `reviewed` → `approved` chưa được định nghĩa ở đâu. Spec này **chỉ** chốt rằng AI pipeline không bao giờ tự set `reviewed`/`approved` — luồng review/approve thủ công là **out of scope** của feature này (xem mục 8).
- **CLR-003**: Quyền của participant thường (không phải Host/Organizer) đối với `transcript.create` và `transcript.read` chưa được policy nào xác nhận rõ. MVP mặc định **không** cấp quyền tạo job cho participant thường; quyền đọc transcript của participant thường tuỳ theo việc họ có là `meeting_participants` hợp lệ của meeting đó hay không (xem mục 3.7).
- **CLR-004**: Cơ chế cụ thể để chuyển `transcripts.security_status` từ `pending_scan` sang `safe`/`restricted`/`blocked` chưa có workflow/feature riêng (không có DLP/antivirus scan thật trong MVP). Xem chính sách tạm thời ở mục 3.8 và mục 6.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host/Organizer cuộc họp | Actor chính, người tạo yêu cầu transcription cho meeting mình tổ chức | Tạo job (`transcript.create`), xem transcript (`transcript.read`), sửa transcript thủ công (`transcript.update`) cho meeting của mình |
| Business Admin | Quản trị nghiệp vụ, có thể tạo/xem/sửa transcript cho mọi meeting trong phạm vi quản lý | Tạo job, xem, sửa transcript; không bị giới hạn theo từng meeting cụ thể |
| System Admin | Quản trị hệ thống, toàn quyền vận hành | Tạo job, xem, sửa transcript; cấu hình `system_configs` liên quan (`transcription.security`) |
| Participant thường | Người tham gia meeting, không phải host | Chỉ có thể xem transcript (`transcript.read`) nếu là participant hợp lệ của meeting; **không** có quyền tạo job hoặc sửa transcript trong MVP (CLR-003) |
| AI Worker (internal service) | Process nội bộ (Node + Python), không phải actor con người | Tiêu thụ BullMQ job, đọc audio từ MinIO private bucket, chạy STT/diarization/separation, viết kết quả vào `transcripts`/`background_jobs` qua service/repository nội bộ. Không có JWT user, không đi qua API HTTP, không cần permission RBAC vì chạy trong process backend |

### 2.2 Role & Permission Rules

- Toàn bộ endpoint người dùng gọi (tạo job, xem transcript, sửa transcript) **đều yêu cầu JWT hợp lệ** — không có endpoint public trong feature này.
- Permission node dùng đúng theo registry hiện có trong `docs/API_CONTRACT_v1.0_with_system_roles.md`: `transcript.create`, `transcript.read`, `transcript.update`. **Không tạo permission mới.**
- AI Worker không gọi API HTTP của chính backend để cập nhật transcript/job — nó dùng trực tiếp service/repository trong cùng codebase backend (Node worker process), nên không cần permission RBAC riêng cho chính nó. Đây là quyết định kiến trúc đã chốt trong `docs/Offline Meeting Transcription Pipeline Plan.md` mục 3.1.3.
- `system.config.transcription.update` (permission có sẵn) dùng cho việc cấu hình `system_configs` key `transcription.security` (UC-128a) — chỉ `SYSTEM_ADMIN`. Đây không phải phần AI Worker xử lý, mà là cấu hình policy tĩnh đọc bởi business logic.

### 2.3 Actor Constraints

- User phải đăng nhập (JWT hợp lệ) trước khi gọi bất kỳ endpoint nào của feature.
- User phải có permission tương ứng (`transcript.create`/`read`/`update`) VÀ thoả điều kiện business rule theo mục 3.7 (ví dụ: là Host/Organizer của đúng meeting, hoặc là Business Admin/System Admin).
- Recording session và source media file phải thuộc đúng meeting được yêu cầu — không cho phép tạo job transcription cho recording của meeting khác.
- AI Worker chỉ được phép chạy trong private network, không có outbound internet tại runtime (rule đã chốt, không thay đổi).

---

## 3. Functional Requirements

> Toàn bộ Functional Requirements viết theo EARS. Giữ keyword EARS bằng tiếng Anh, nội dung nghiệp vụ bằng tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cung cấp endpoint tạo transcription job cho một meeting đã có recording session hợp lệ, theo đúng UC-125 (`POST /api/v1/meetings/{meetingId}/transcription-jobs`).
FR-002: THE system SHALL điều phối việc xử lý transcription thông qua `background_jobs` và BullMQ queue `transcription`, không xử lý AI trực tiếp trong HTTP request.
FR-003: THE system SHALL lưu kết quả transcription vào bảng `transcripts` hiện có, không tạo bảng mới (`transcript_segments`, `speaker_profiles`, ... đều bị cấm trong MVP).
FR-004: THE system SHALL chạy toàn bộ pipeline AI (STT, diarization, overlap detection, separation best-effort) trong AI Worker nội bộ, không gọi bất kỳ cloud STT/API bên ngoài nào.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN Host/Organizer hoặc Business Admin/System Admin gửi yêu cầu tạo transcription job hợp lệ, THE system SHALL tạo một row `background_jobs` với `job_type = transcription`, trạng thái `queued`, và một row/cập nhật `transcripts` ở trạng thái `processing`.
FR-006: WHEN background job được tạo thành công, THE system SHALL đẩy job vào BullMQ queue `transcription` với `jobId = transcription:{backgroundJobId}` để chống duplicate.
FR-007: WHEN AI Worker nhận job từ BullMQ, THE system SHALL cập nhật `background_jobs.status = running` và `transcripts.status = processing` trước khi bắt đầu xử lý audio.
FR-008: WHEN AI Worker tải xong audio từ MinIO và chuẩn hoá thành công (mono/giữ channel theo `speakerMappingMode`, 16kHz, WAV/FLAC), THE system SHALL chạy faster-whisper theo model/device/compute_type đang active của `AI_PROFILE` hiện tại.
FR-009: WHEN faster-whisper hoàn tất, THE system SHALL chạy pyannote.audio để sinh diarization turns và đánh dấu các khoảng overlap, nếu `DIARIZATION_ENABLED=true` và `OVERLAP_DETECTION_ENABLED=true`.
FR-010: WHEN pyannote phát hiện một khoảng overlapped speech VÀ `SEPARATION_ENABLED=true`, THE system SHALL chạy SpeechBrain SepFormer best-effort chỉ trên khoảng overlap đó, không chạy cho toàn bộ audio.
FR-011: WHEN pipeline AI hoàn tất không lỗi nghiêm trọng, THE system SHALL ghi `raw_text`, `cleaned_text`, `speaker_segments_json`, `detected_speakers_json`, `confidence_score` vào `transcripts` và đặt `transcripts.status = draft`.
FR-012: WHEN `transcripts.status` được đặt thành `draft` sau khi AI xử lý thành công, THE system SHALL đồng thời đặt `background_jobs.status = completed`.
```

### 3.3 State-driven Requirements

```text
FR-013: WHILE một transcription job cho cùng `recordingSessionId` đang ở trạng thái `processing`, THE system SHALL từ chối tạo job mới cho cùng recording session đó nếu `forceRerun` không phải `true`.
FR-014: WHILE `AI_PROFILE=local`, THE system SHALL giới hạn audio input ở tối đa `MAX_AUDIO_DURATION_LOCAL_SECONDS` (mặc định 300 giây) trước khi cho phép AI Worker load model.
FR-015: WHILE transcript đang ở trạng thái `draft`, THE system SHALL coi đây là bản nháp do AI tạo, KHÔNG phải biên bản chính thức, và không tự động chuyển sang `reviewed` hoặc `approved`.
```

### 3.4 Optional Feature Requirements

```text
FR-016: WHERE `AI_PROFILE=local`, THE system SHALL dùng `WHISPER_MODEL=small` hoặc `medium` với `WHISPER_DEVICE=cpu` và `WHISPER_COMPUTE_TYPE=int8`, không dùng `large-v3` làm mặc định.
FR-017: WHERE `AI_PROFILE=production-gpu`, THE system SHALL dùng `WHISPER_MODEL=large-v3` với `WHISPER_DEVICE=cuda` và `WHISPER_COMPUTE_TYPE=float16`, và yêu cầu container detect được CUDA khi khởi động.
FR-018: WHERE `SEPARATION_ENABLED=false` (mặc định ở local), THE system SHALL bỏ qua hoàn toàn bước SepFormer, kể cả khi có overlap được phát hiện.
FR-019: WHERE hệ thống phát hiện RAM khả dụng (đo bằng Node `os.freemem()` trước khi spawn Python) thấp hơn `AI_WORKER_MIN_FREE_RAM_MB`, THE system SHALL tự động bỏ qua bước SepFormer (nếu đang bật) và ghi warning `sepformer_skipped_low_resources`, không bỏ qua faster-whisper hoặc pyannote.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-020: IF meeting không tồn tại, THEN THE system SHALL từ chối yêu cầu với `MEETING_NOT_FOUND`.
FR-021: IF recording session không thuộc meeting được chỉ định, THEN THE system SHALL từ chối yêu cầu với `RECORDING_SESSION_NOT_FOUND`.
FR-022: IF không tìm thấy source media file audio hợp lệ (`is_active=true`, `deleted_at IS NULL`) cho recording session, THEN THE system SHALL từ chối yêu cầu với `SOURCE_MEDIA_NOT_FOUND`.
FR-023: IF đã có transcription job đang `processing` cho recording session và `forceRerun=false`, THEN THE system SHALL từ chối yêu cầu với `409 TRANSCRIPTION_JOB_ALREADY_RUNNING`.
FR-024: IF `AI_PROFILE=local` VÀ audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS`, THEN THE system SHALL từ chối job trước khi load model với error `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`.
FR-025: IF `AI_PROFILE=production-gpu` VÀ container không detect được CUDA khi khởi động, THEN THE system SHALL fail fast với `CUDA_NOT_AVAILABLE_FOR_PROFILE`, không tự fallback CPU âm thầm.
FR-026: IF pyannote diarization thất bại nhưng faster-whisper STT thành công, THEN THE system SHALL vẫn hoàn tất transcript với mọi segment có `speakerLabel = "unknown"` và một warning rõ ràng, không fail toàn bộ job.
FR-027: IF SpeechBrain SepFormer lỗi hoặc kết quả tách dưới `SEPARATION_ACCEPT_MIN_CONFIDENCE`, THEN THE system SHALL giữ `speakerLabel = "unknown"`, đặt `lowConfidence = true` và `manualReviewRequired = true` cho segment đó, không fail toàn bộ job.
FR-028: IF một segment có overlap nhưng không speaker nào đạt `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO` và `SPEAKER_ASSIGN_MIN_CONFIDENCE`, THEN THE system SHALL gán `speakerLabel = "unknown"`, không ép gán speaker bất kỳ.
FR-029: IF pipeline AI gặp lỗi nghiêm trọng (model thiếu, audio không hợp lệ, crash không phục hồi), THEN THE system SHALL đặt `transcripts.status = failed` và `background_jobs.status = failed`, ghi error code ngắn gọn, không ghi nội dung transcript/audio vào log lỗi.
```

### 3.6 Workflow Requirements

```text
FR-030: WHEN AI Worker bắt đầu một job, THE system SHALL log rõ `jobId`, `aiProfile`, `whisperModel`, `device`, `computeType`, `diarizationEnabled`, `separationEnabled` (không log nội dung transcript/audio/secret).
FR-031: WHILE job đang ở trạng thái `processing`/`running`, THE system SHALL không cho phép một job thứ hai xử lý cùng `backgroundJobId` (idempotency qua `jobId = transcription:{backgroundJobId}`).
FR-032: IF AI Worker process bị crash giữa lúc xử lý, THEN THE system SHALL không để job treo `processing`/`running` vô thời hạn — cần cơ chế retry/cleanup theo policy BullMQ hiện có (retry 2-3 lần cho lỗi tạm thời, không retry cho lỗi validation).
```

### 3.7 Authorization Requirements

```text
FR-033: IF user không có permission `transcript.create`, THEN THE system SHALL từ chối yêu cầu tạo transcription job mà không tạo `background_jobs` hoặc `transcripts` nào.
FR-034: WHEN user có permission `transcript.create` gọi tạo job, THE system SHALL chỉ cho phép thực hiện nếu user là Host/Organizer của đúng meeting đó, hoặc user có role Business Admin/System Admin.
FR-035: IF user không có permission `transcript.read`, THEN THE system SHALL từ chối yêu cầu xem transcript.
FR-036: WHEN user có permission `transcript.read` gọi xem transcript, THE system SHALL chỉ trả dữ liệu nếu user là Host/Organizer hoặc một `meeting_participants` hợp lệ của đúng meeting đó, hoặc user có role Business Admin/System Admin; THE system SHALL NOT trả transcript của meeting khác.
FR-037: IF user không có permission `transcript.update`, THEN THE system SHALL từ chối yêu cầu sửa transcript thủ công.
FR-038: WHEN user có permission `transcript.update` gọi sửa transcript, THE system SHALL chỉ cho phép thực hiện nếu user là Host/Organizer của đúng meeting đó, hoặc user có role Business Admin/System Admin; participant thường KHÔNG được sửa transcript trong MVP.
FR-039: THE system SHALL NOT cấp quyền tạo/sửa transcript cho AI Worker thông qua bất kỳ permission RBAC nào — AI Worker chỉ ghi dữ liệu qua service/repository nội bộ trong cùng process backend.
```

### 3.8 Data & State Requirements

```text
FR-040: WHEN một transcript mới được tạo bởi transcription job, THE system SHALL đặt `security_status = pending_scan` mặc định.
FR-041: THE system SHALL NOT để AI Worker tự đổi `transcripts.security_status` sang `safe`, `restricted`, hoặc `blocked` — AI Worker chỉ được set/giữ `pending_scan`.
FR-042: THE system SHALL chỉ cho phép chuyển `transcripts.status` qua các giá trị `processing`, `draft`, `failed` trong phạm vi pipeline AI của feature này; việc chuyển sang `reviewed`/`approved`/`hidden` thuộc về một luồng review riêng (out of scope, mục 8).
FR-043: WHEN pipeline AI hoàn tất với nhiều segment có `manualReviewRequired = true`, THE system SHALL vẫn đặt `transcripts.status = draft` (không có trạng thái trung gian mới), nhưng giữ warning rõ trong dữ liệu JSON để UI nhận biết cần review.
FR-044: IF `forceRerun = true` cho một recording session đã có transcript, THEN THE system SHALL tăng `transcripts.version_no` cho lần tạo mới, không xoá version cũ.
```

### 3.9 Notification / Audit Requirements

```text
FR-045: WHEN transcript chuyển sang `draft` thành công, THE system SHALL gửi in-app notification cho Host của meeting nếu `NotificationsService` đã sẵn sàng, qua cơ chế notification/BullMQ hiện có, không tự insert notification bằng tay.
FR-046: IF gửi notification thất bại, THEN THE system SHALL NOT làm fail transcription job — lỗi notification chỉ được log nội bộ.
FR-047: WHEN một transcription job hoàn tất hoặc thất bại, THE system SHALL ghi đủ thông tin để audit/troubleshoot (jobId, meetingId, recordingSessionId, status, duration, error code), không ghi raw transcript/audio content/secret vào log.
```

### 3.10 Integration Requirements

```text
FR-048: WHERE MinIO private bucket được cấu hình, THE system SHALL chỉ cho AI Worker truy cập audio bằng SDK/internal credential, không qua public URL.
FR-049: WHERE model weights (`faster-whisper`, `pyannote`, `SpeechBrain SepFormer`) cần preload, THE system SHALL chỉ tải model ở build/preload phase (có internet), không tải ở runtime container.
FR-050: IF AI Worker container thử kết nối ra internet công khai lúc runtime, THEN THE system SHALL bị chặn ở network layer (Docker internal network/firewall), không dựa vào code application để tự kiềm chế.
```

### 3.11 Complex / Combined Requirements

```text
FR-051: WHILE `AI_PROFILE=local`, WHEN audio hợp lệ (≤ `MAX_AUDIO_DURATION_LOCAL_SECONDS`) được gửi để tạo job, THE system SHALL xử lý bằng `small`/`medium` + CPU + `int8`, không yêu cầu đạt tiêu chí thời gian xử lý nào (chỉ cần hoàn thành).
FR-052: WHERE `AI_PROFILE=production-gpu` được dùng VÀ `SEPARATION_ENABLED=true`, WHEN pyannote phát hiện overlap, THE system SHALL chạy SepFormer trên GPU và áp dụng đúng threshold confidence như ở local profile (business logic không đổi giữa 2 môi trường).
```

### 3.12 Requirement Notes

- Toàn bộ threshold (`SPEAKER_ASSIGN_MIN_OVERLAP_RATIO`, `SPEAKER_ASSIGN_MIN_CONFIDENCE`, `OVERLAP_DETECTION_MIN_CONFIDENCE`, `SEPARATION_ACCEPT_MIN_CONFIDENCE`, `TRANSCRIPT_MANUAL_REVIEW_THRESHOLD`) đọc từ config, không hard-code, và giữ nguyên giá trị giữa Local/Production profile.
- Không mô tả implementation detail của Python pipeline (tên class, hàm) trong spec này — chi tiết đó thuộc `plan.md`/`tasks.md`.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001, FR-005, FR-006 | Core / Event-driven | UC-125, `docs/Offline Meeting Transcription Pipeline Plan.md` mục 4.2 | Tạo job |
| FR-007–FR-012 | Event-driven | Plan mục 4.3, T008-T023 | Luồng AI Worker |
| FR-013, FR-023 | State-driven / Unwanted | Plan mục 4.2 (T005) | Chống duplicate job |
| FR-014, FR-024 | State-driven / Unwanted | Plan mục 2.5.2, T002B | Resource guard local |
| FR-016, FR-017, FR-025 | Optional Feature / Unwanted | Plan mục 2.5, T002A, T002C | Profile switching |
| FR-018, FR-019, FR-027 | Optional Feature / Unwanted | Plan mục 11 R4, T002E, T019-T020 | SepFormer best-effort + guard |
| FR-026, FR-028 | Unwanted Behavior | Plan mục 5.2, T018, T031 | Không ép gán speaker |
| FR-033–FR-039 | Authorization | API_CONTRACT UC-125/126/127, Plan mục 4.2 | Authorization rules (mục tiêu chính của lần cập nhật này) |
| FR-040–FR-044 | Data & State | Plan mục 6.3, CLR-002, CLR-004 | Security status + draft-only policy |
| FR-045–FR-047 | Notification/Audit | Plan mục 4.3, T027, T029 | Sensitive logging + notification best-effort |
| FR-048–FR-050 | Integration | Plan mục 11 R6, T-STORAGE-001, T025 | No outbound internet, MinIO private |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: WHERE `AI_PROFILE=local`, THE system SHALL NOT có yêu cầu thời gian xử lý cụ thể nào — mục tiêu duy nhất là hoàn thành đúng luồng cho audio 2-5 phút.
NFR-002: WHERE `AI_PROFILE=production-gpu`, THE system SHALL hỗ trợ audio dài 30-90 phút thông qua chunking, không yêu cầu real-time tuyệt đối nhưng nên gần hoặc nhanh hơn real-time tuỳ tải GPU.
NFR-003: THE system SHALL giới hạn `AI_WORKER_MAX_CONCURRENT_JOBS=1` ở cả 2 profile trong MVP để tránh quá tải tài nguyên.
```

### 4.2 Security

```text
NFR-004: THE system SHALL NOT gọi bất kỳ cloud STT/API bên ngoài nào (Google STT, OpenAI, Azure, AssemblyAI, v.v.) ở bất kỳ profile nào.
NFR-005: THE system SHALL đảm bảo AI Worker không có outbound internet ở runtime, kiểm chứng bằng network-layer test (không chỉ dựa vào code).
NFR-006: THE system SHALL lưu audio gốc và file trung gian trong MinIO private bucket, không dùng public URL ở bất kỳ bước nào của AI Worker.
NFR-007: THE system SHALL NOT log raw transcript, raw audio path công khai, MinIO secret, hoặc JWT/service token.
NFR-008: THE system SHALL preload toàn bộ model weights vào Docker image hoặc mounted volume trước khi container chạy, không tải runtime; quyền truy cập HuggingFace gated model (pyannote) chỉ dùng ở bước build/preload, không tồn tại trong container runtime.
```

### 4.3 Reliability & Consistency

```text
NFR-009: THE system SHALL không để một transcription job treo ở trạng thái `processing`/`running` vô thời hạn nếu AI Worker crash — cần cơ chế retry/cleanup dựa trên BullMQ.
NFR-010: THE system SHALL giữ `background_jobs.status` và `transcripts.status` đồng bộ ở mọi thời điểm (completed/failed phải khớp giữa 2 bảng).
NFR-011: IF SepFormer hoặc pyannote lỗi, THEN THE system SHALL không làm fail toàn bộ pipeline trừ khi cả STT cũng lỗi — luôn ưu tiên trả kết quả STT có ích hơn fail cứng.
```

### 4.4 Usability

```text
NFR-012: THE system SHALL trả error code rõ ràng (`MEETING_NOT_FOUND`, `RECORDING_SESSION_NOT_FOUND`, `SOURCE_MEDIA_NOT_FOUND`, `TRANSCRIPTION_JOB_ALREADY_RUNNING`, `TRANSCRIPTION_DISABLED`) thay vì lỗi chung.
NFR-013: WHEN GET transcript với `includeSegments=false`, THE system SHALL không trả full segment JSON để tránh response quá nặng.
```

### 4.5 Observability

```text
NFR-014: THE system SHALL log đủ để biết job nào đang chạy bằng profile/model/device nào, không cần đọc code.
NFR-015: THE system SHALL ghi nhận warning rõ ràng (`overlap_separation_low_confidence`, `sepformer_skipped_low_resources`, ...) trong JSON kết quả khi pipeline đi qua nhánh fallback.
```

### 4.6 Maintainability

```text
NFR-016: THE system SHALL đọc toàn bộ model/device/compute_type/threshold từ environment variable theo `AI_PROFILE`, không hard-code trong code Python hoặc Node worker.
NFR-017: THE system SHALL có unit/integration/smoke test cho luồng tạo job, gán speaker, lifecycle BullMQ, và resource guard (chi tiết ở `tasks.md`).
```

---

## 5. Data Model

> Toàn bộ entity dưới đây đã tồn tại trong DB Compact và code hiện có. Spec này **không đề xuất bảng/cột mới**.

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `transcripts` | Lưu kết quả cuối: raw_text, cleaned_text, speaker_segments_json, detected_speakers_json, confidence_score, security_status, status, version_no | Đã có entity `TranscriptEntity`, đủ cột |
| `background_jobs` | Tracking job async (`job_type = transcription`) | Đã có entity `BackgroundJobEntity`, đủ enum |
| `media_files` | Metadata audio/video gốc, lưu trong MinIO (`storage_provider = minio`, `storage_bucket`, `storage_key`) | Đã có entity, hỗ trợ `MediaFileType.AUDIO`/`VIDEO`/`TRANSCRIPT` |
| `recording_sessions` | Recording session nguồn cho transcript | Đã có entity, không đổi |
| `meetings`, `meeting_participants` | Dùng để xác định Host/Organizer và participant hợp lệ cho authorization (mục 3.7) | Reuse, không đổi |
| `users`, `roles`, `permissions`, `user_roles`, `role_permissions` | Dùng cho RBAC (`transcript.create/read/update`) | Reuse, không đổi |
| `system_configs` | Lưu policy `transcription.security` (retentionDays, encryptAtRest, deleteRawAudioAfterTranscription, externalProvider, accessRules) | Reuse key đã có trong API_CONTRACT UC-128a |

### 5.2 Dữ liệu đầu vào (tạo job)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `recordingSessionId` | `uuid` | Có | Recording session nguồn | Phải thuộc meeting trong path, phải có media file audio active |
| `language` | `string` | Không | Mã ngôn ngữ, mặc định `vi-VN` | Theo danh sách ngôn ngữ hỗ trợ |
| `speakerMappingMode` | `enum` | Không | `channel_zone` hoặc `diarization_only` | Enum cố định |
| `forceRerun` | `boolean` | Không | Có rerun job dù đang processing | Mặc định `false` |

### 5.3 Dữ liệu đầu ra (GET transcript)

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `transcriptId` | `uuid` | ID transcript |
| `status` | `enum` | `processing`/`draft`/`failed` (phạm vi feature này; `reviewed`/`approved`/`hidden` ngoài scope) |
| `versionNo` | `integer` | Tăng khi `forceRerun` |
| `confidenceScore` | `number` | Confidence tổng hợp |
| `cleanedText` | `string` | Text đã chuẩn hoá (MVP: bằng `rawText`) |
| `segments[]` | `array` | Theo schema `contracts/ai-worker-result-schema.json`, có pagination khi `includeSegments=true` |

### 5.4 State / Status Model

| Status | Ý nghĩa | Có thể chuyển sang (trong scope feature này) | Điều kiện chuyển |
|---|---|---|---|
| `processing` | Job đang chạy AI pipeline | `draft`, `failed` | AI Worker hoàn tất thành công / lỗi nghiêm trọng |
| `draft` | AI đã tạo xong bản nháp, **chưa phải biên bản chính thức** | (ngoài scope: `reviewed`, `approved`) | Không tự chuyển tiếp trong feature này |
| `failed` | Pipeline lỗi nghiêm trọng | `processing` (nếu `forceRerun`) | Tạo job mới với `forceRerun=true` |

### 5.5 Data Constraints

- Không thêm bảng/cột mới (`transcript_segments`, `speaker_profiles`, `audio_segments` đều bị cấm, đúng theo `docs/Offline Meeting Transcription Pipeline Plan.md` mục 2 và `AGENTS.md`).
- `speaker_segments_json`/`detected_speakers_json` phải theo đúng schema `contracts/ai-worker-result-schema.json`.
- `security_status` chỉ được AI Worker set/giữ ở `pending_scan`; chuyển sang `safe`/`restricted`/`blocked` là hành động quản trị ngoài scope (CLR-004).
- Không lưu audio/transcript thật (dữ liệu công ty thật) vào Git hoặc test fixtures công khai.

### 5.6 Data Lifecycle

- `transcripts` row được tạo/cập nhật khi job được enqueue (status `processing`), rồi cập nhật lại khi AI Worker hoàn tất (status `draft` hoặc `failed`).
- `background_jobs` row theo dõi lifecycle riêng (`queued` → `running` → `completed`/`failed`), đồng bộ với `transcripts.status`.
- File audio tạm trong AI Worker (`AI_WORKER_TEMP_DIR`) bị xoá sau khi job kết thúc (thành công hoặc lỗi); không giữ lâu hơn cần thiết.

### 5.7 Cần làm rõ

- Xem CLR-001 đến CLR-004 ở mục 1.5.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `recordingSessionId` thiếu hoặc không phải UUID hợp lệ, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
ERR-002: IF `language` không thuộc danh sách hỗ trợ, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
ERR-003: IF `speakerMappingMode` không thuộc enum cho phép, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-004: IF user không có JWT hợp lệ, THEN THE system SHALL trả `401 Unauthorized`.
ERR-005: IF user không có permission `transcript.create`/`read`/`update` tương ứng, THEN THE system SHALL trả `403 PERMISSION_DENIED`.
ERR-006: IF user có permission nhưng không phải Host/Organizer/Admin hợp lệ của meeting, THEN THE system SHALL trả `403 PERMISSION_DENIED` và không tiết lộ dữ liệu transcript của meeting đó.
```

### 6.3 Business Rule Errors

```text
ERR-007: IF meeting không tồn tại, THEN THE system SHALL trả `404 MEETING_NOT_FOUND`.
ERR-008: IF recording session không thuộc meeting, THEN THE system SHALL trả `404 RECORDING_SESSION_NOT_FOUND`.
ERR-009: IF không có source media file audio hợp lệ, THEN THE system SHALL trả `404 SOURCE_MEDIA_NOT_FOUND`.
ERR-010: IF transcription bị tắt qua feature flag (`TRANSCRIPTION_ENABLED=false`), THEN THE system SHALL trả `403 TRANSCRIPTION_DISABLED`.
```

### 6.4 Conflict Errors

```text
ERR-011: IF đã có job đang `processing` cho recording session và `forceRerun=false`, THEN THE system SHALL trả `409 TRANSCRIPTION_JOB_ALREADY_RUNNING`.
```

### 6.5 Integration / AI Worker Errors

```text
ERR-012: IF audio vượt `MAX_AUDIO_DURATION_LOCAL_SECONDS` ở `AI_PROFILE=local`, THEN THE system SHALL trả lỗi `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE` qua `background_jobs.error_message`, không xử lý job.
ERR-013: IF `AI_PROFILE=production-gpu` mà container thiếu CUDA, THEN THE system SHALL fail fast worker startup với `CUDA_NOT_AVAILABLE_FOR_PROFILE`.
ERR-014: IF model weights (whisper/pyannote/sepformer khi enabled) không tồn tại tại path cấu hình, THEN THE system SHALL fail fast worker với error rõ, không tự tải runtime.
ERR-015: IF AI pipeline lỗi không phục hồi (audio hỏng, format không hỗ trợ), THEN THE system SHALL đặt `transcripts.status = failed`, `background_jobs.status = failed`, ghi error code ngắn gọn (`UNSUPPORTED_MEDIA_FORMAT`, ...), không ghi nội dung audio/transcript vào log.
```

### 6.6 Error Response Expectations

Theo chuẩn response lỗi của dự án (mục 8.2 `AGENTS.md`): `success=false`, `message`, `error.code`, `error.details`, `timestamp`, `path`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given Host của một meeting đã có recording session với media file audio active,
When Host gọi `POST /api/v1/meetings/{meetingId}/transcription-jobs` với `recordingSessionId` hợp lệ,
Then hệ thống trả `202`, tạo `background_jobs` (queued) và `transcripts` (processing), và enqueue job BullMQ.
```

```text
AC-002:
Given một background job transcription đã `completed` với `AI_PROFILE=local`, model `small`, audio mẫu 2-5 phút,
When Host gọi `GET /api/v1/meetings/{meetingId}/transcript`,
Then hệ thống trả transcript với `status=draft`, có `rawText`/`cleanedText` không rỗng, và `speaker_segments_json` hợp lệ theo schema.
```

### 7.2 Validation Cases

```text
AC-003:
Given request thiếu `recordingSessionId`,
When Host gọi tạo transcription job,
Then hệ thống trả `400 VALIDATION_ERROR` và không tạo `background_jobs`/`transcripts` nào.
```

### 7.3 Authorization Cases

```text
AC-004:
Given user không phải Host/Organizer/Admin của meeting và không có permission `transcript.create`,
When user gọi tạo transcription job cho meeting đó,
Then hệ thống trả `403 PERMISSION_DENIED` và không tạo job.
```

```text
AC-005:
Given user là participant hợp lệ của meeting nhưng không phải Host,
When user gọi `GET .../transcript` với permission `transcript.read`,
Then hệ thống trả transcript của đúng meeting đó (không leak meeting khác), nhưng user này không thể gọi `PATCH /transcripts/{id}/segments` thành công (out of authorization cho `transcript.update` theo FR-038).
```

### 7.4 Business Rule Cases

```text
AC-006:
Given recording session đang có một job `processing` và `forceRerun=false`,
When Host gọi tạo job mới cho cùng recording session,
Then hệ thống trả `409 TRANSCRIPTION_JOB_ALREADY_RUNNING`.
```

### 7.5 State Transition / Profile Cases

```text
AC-007:
Given `AI_PROFILE=local` và `MAX_AUDIO_DURATION_LOCAL_SECONDS=300`,
When AI Worker nhận job với audio dài 360 giây,
Then job bị reject với `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE` trước khi load model, `background_jobs.status=failed`.
```

```text
AC-008:
Given `AI_PROFILE=production-gpu` nhưng container không có CUDA,
When AI Worker khởi động,
Then worker fail fast với `CUDA_NOT_AVAILABLE_FOR_PROFILE`, không tự fallback CPU.
```

### 7.6 Speaker Assignment / Overlap Cases

```text
AC-009:
Given pyannote phát hiện overlap nhưng SepFormer trả confidence dưới `SEPARATION_ACCEPT_MIN_CONFIDENCE`,
When pipeline build segment cuối,
Then segment đó có `speakerLabel="unknown"`, `lowConfidence=true`, `manualReviewRequired=true`, và job vẫn `completed` (không fail).
```

```text
AC-010:
Given `SEPARATION_ENABLED=false` (mặc định local),
When pyannote phát hiện overlap,
Then SepFormer không được gọi, segment overlap vẫn được đánh dấu `overlap=true` và xử lý theo quy tắc unknown/manual review nếu không đạt threshold.
```

### 7.7 Draft / Security Status Cases

```text
AC-011:
Given pipeline AI hoàn tất thành công với confidence cao,
When transcript được lưu,
Then `transcripts.status="draft"` (KHÔNG `approved`/`reviewed`) và `security_status="pending_scan"`.
```

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-005, FR-006 | T005, T008 (tasks.md) |
| AC-002 | FR-011, FR-012 | T021-T023, T033 |
| AC-003 | ERR-001 | T004, T030 |
| AC-004 | FR-033, FR-034, ERR-005 | T030 |
| AC-005 | FR-036, FR-038 | T006, T030 |
| AC-006 | FR-023, ERR-011 | T005, T030 |
| AC-007 | FR-014, FR-024, ERR-012 | T002B, T035A |
| AC-008 | FR-017, FR-025, ERR-013 | T002C, T035A |
| AC-009 | FR-027, FR-028 | T019, T020, T031, T034 |
| AC-010 | FR-018 | T019, T034 |
| AC-011 | FR-040, FR-042 | T021, T023, T032 |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Real-time transcription khi meeting đang diễn ra.
- Speaker identification bằng voiceprint/embedding để map chính xác user (chỉ dùng diarization + channel/zone mapping nếu có dữ liệu).
- Luồng review/approve thủ công để chuyển transcript từ `draft` → `reviewed` → `approved` (CLR-002) — feature này chỉ tạo `draft`.
- Cơ chế DLP/antivirus scan thật để chuyển `security_status` từ `pending_scan` sang `safe`/`restricted`/`blocked` (CLR-004).
- UC-128b (external STT provider callback qua HMAC) — không áp dụng cho kiến trúc AI Worker nội bộ của feature này (CLR-001).
- Fine-tune model, RAG/semantic search trên transcript, tự động tạo minutes bằng LLM cloud, cloud STT fallback.
- UI review transcript phức tạp (chỉ cần UI nhận biết `manualReviewRequired`/`lowConfidence` ở mức cơ bản).
- Triển khai Production EC2 GPU thật (provisioning, chi phí, instance type) — đây là **future target**, không phải MVP commitment của feature này (xem `plan.md` mục môi trường).
- Benchmark hiệu năng production trên laptop local — laptop chỉ dùng để validate luồng, không đo performance.

### 8.1 Không triển khai trong feature này

- Không implement vector DB/embedding cho transcript.
- Không thêm bảng `transcript_segments`, `speaker_profiles`, `audio_segments`.
- Không thêm permission mới ngoài `transcript.create`/`read`/`update` đã có.
- Không tự động publish `meeting_minutes` từ transcript draft.

### 8.2 Có thể xem xét ở feature khác

- Luồng review/approve transcript thủ công (feature riêng, dùng `transcript.update` + UI review).
- Tích hợp DLP/antivirus scan thật cho `security_status`.
- Production EC2 GPU deployment (feature/infra riêng, khi có ngân sách/timeline xác nhận).
- Voiceprint-based speaker identification (nếu công ty chấp nhận rủi ro privacy liên quan).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tự động chuyển `transcripts.status` sang `reviewed` hoặc `approved` trong phạm vi feature này.
OOS-002: THE system SHALL NOT tạo bảng/cột database mới ngoài những gì đã được xác nhận trong mục 5.
OOS-003: WHERE Production EC2 GPU được đề cập trong tài liệu, THE system SHALL NOT coi đó là yêu cầu triển khai bắt buộc của MVP — chỉ là kiến trúc đích tương lai.
OOS-004: THE system SHALL NOT implement UC-128b (external STT callback) như một phần của pipeline AI Worker nội bộ trong feature này.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Đã có đủ 5 EARS basic patterns.
- [x] Mỗi requirement có mã ID rõ ràng, traceability đầy đủ.
- [x] Authorization rules cho create/read/update transcript đã bổ sung rõ (mục 3.7).
- [x] Security status policy cho MVP đã bổ sung rõ (mục 3.8, mục 6, CLR-004).
- [x] Quy tắc transcript AI là draft, không auto approved đã bổ sung rõ (FR-015, FR-042, AC-011, OOS-001).
- [x] Local MVP chỉ dùng small/medium CPU int8 đã bổ sung rõ (FR-016, NFR-001).
- [x] Production GPU là future target, không phải MVP commitment đã bổ sung rõ (FR-017, mục 8, OOS-003).
- [x] Không tự ý thêm bảng/permission mới ngoài tài liệu nguồn.
- [x] Các điểm thiếu thông tin đã đưa vào `Cần làm rõ` (CLR-001 đến CLR-004).
