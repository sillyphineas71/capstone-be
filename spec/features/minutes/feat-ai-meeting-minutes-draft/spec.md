# Feature Specification: Tạo biên bản họp nháp bằng AI (AI Meeting Minutes Draft)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-07 | Đóng NEEDS CLARIFICATION duy nhất ở mục 1.5 sau benchmark T018 (Phase 3): chốt model `qwen2.5:3b-instruct` cho máy dev, giữ `maxInputTokens=6000` — chi tiết ở plan.md mục 14 | Mục 1.5 |
| 2026-07-07 | Giải quyết toàn bộ câu hỏi clarify (BL/RP/VR/DM/EH/AC/SB): chốt endpoint path `POST /meetings/:meetingId/minutes/ai-draft-jobs`; định nghĩa predicate "active" = `deleted_at IS NULL`; dedup job qua `related_entity_type/id` (indexed); retry policy attempts=2 + timeout env `AI_SUMMARY_LLM_TIMEOUT_MS`; forceRerun = UPDATE tại chỗ + đổi `prepared_by` theo người trigger; transcript `status=draft` là input hợp lệ; language chỉ `vi-VN` trong MVP; retention cleanup defer sang feature riêng; bổ sung seed `system_configs` key `ai.minutes_summary` với defaults; ghi rõ các cột đã tồn tại sẵn (version_no, linked_transcript_id, related_entity_*, error_message) không phải schema change; AI Worker Summary = BullMQ processor trong NestJS, chỉ Ollama là container riêng | Các mục 1, 2, 3, 4, 5, 6, 7, 8 |
| 2026-07-06 | Khởi tạo spec cho feature `feat-ai-meeting-minutes-draft` dựa trên tài liệu định hướng AI Summarize (AI_Summarize_SMRMPTS_Architecture.pdf) và 8 quyết định đã chốt với Product Owner ngày 2026-07-06: thêm cột `ai_summary_json`, Qwen2.5-Instruct qua Ollama, tách container chạy tuần tự, user-triggered, retention 90 ngày, permission `meeting.minutes.ai_draft.create`, chốt schema JSON trước cho FE, scope tối giản cho timeline < 2 tuần | Toàn bộ file |

- **Feature ID**: MKM-AI-01
- **Feature Name**: Tạo biên bản họp nháp bằng AI từ transcript (AI Meeting Minutes Draft)
- **Module / Domain**: minutes (kết hợp queue, administration/background_jobs, AI Worker Summary)
- **Created Date**: 2026-07-06
- **Status**: Draft
- **Source Documents**:
  - AI_Summarize_SMRMPTS_Architecture.pdf (tài liệu định hướng AI Summarize cho SMRMPTS)
  - database_v3_2_compact_39_tables.md (bảng `meeting_minutes`, `transcripts`, `background_jobs`, `system_configs`, `audit_logs`)
  - spec/features/minutes/feat-create-draft-meeting-minutes/spec.md (UC-MKM-01, quy tắc một biên bản active/meeting)
  - Biên bản quyết định với Product Owner ngày 2026-07-06 và 2026-07-07 (ghi trong CHANGELOG)
  - CLAUDE.md / AGENTS.md (convention backend)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống đã có pipeline Speech-to-Text offline (faster-whisper) sinh transcript cho cuộc họp, lưu tại bảng `transcripts` (`raw_text`, `cleaned_text`, `speaker_segments_json`). Transcript dài, có thể chứa lỗi STT, khó đọc và khó nắm ý chính. Host hiện phải tự đọc toàn bộ transcript rồi soạn biên bản họp thủ công qua UC-MKM-01.

Feature này bổ sung khả năng dùng LLM self-hosted (chạy trong hạ tầng nội bộ, không gửi dữ liệu ra external API) để tự động sinh **bản nháp** biên bản họp từ transcript: tóm tắt, ý chính, quyết định, action items, rủi ro, câu hỏi mở và các phần chưa chắc chắn. Bản nháp luôn phải được Host review/chỉnh sửa trước khi ban hành — AI không bao giờ tự publish.

Bối cảnh kỹ thuật quan trọng đã chốt:

- Môi trường local dev hiện **tạm khóa pyannote diarization/overlap detection** (giảm tải RAM/CPU), nên segment transcript có `speakerLabel = "unknown"`. Do đó AI thường **không xác định được người nói** — `owner` của action item mặc định là `"Không xác định"` trừ khi người nói tự xưng tên trong lời thoại. Đây là hành vi được chấp nhận.
- **Kiến trúc thành phần (chốt 2026-07-07)**: AI Worker Summary là **BullMQ processor chạy trong chính NestJS backend** (cùng pattern `TranscriptionWorkerProcessor` hiện có), KHÔNG phải external service riêng. Chỉ **LLM runtime (Ollama + Qwen2.5-Instruct)** là container/process tách biệt, expose internal HTTP API trong private network.
- LLM job xử lý **tuần tự** với STT job (concurrency = 1, không chạy đồng thời trên cùng tài nguyên).
- Job AI summary là **user-triggered** (Host bấm nút), không tự động chạy khi transcript hoàn tất.

### 1.2 Mục tiêu

Cho phép Host của cuộc họp (hoặc System Admin) tạo một background job sinh bản nháp biên bản họp bằng AI từ một transcript đã hoàn tất. Khi job hoàn thành, hệ thống tạo bản ghi `meeting_minutes` ở trạng thái `draft`, chứa summary và dữ liệu có cấu trúc (`decisions_json`, `action_items_json`, `ai_summary_json`) để Host review, chỉnh sửa và ban hành qua các feature minutes hiện có.

### 1.3 Giá trị mang lại

- Host tiết kiệm thời gian đọc transcript dài, chỉ cần review/sửa bản nháp AI thay vì soạn từ đầu.
- Chuẩn hóa cấu trúc biên bản: summary, key points, decisions, action items, risks, open questions.
- Các phần AI không chắc chắn được đánh dấu rõ (`uncertainParts`, `confidence`) giúp review an toàn, giảm rủi ro biên bản sai.
- Dữ liệu họp không rời khỏi hạ tầng nội bộ (self-hosted LLM), đáp ứng yêu cầu bảo mật.

### 1.4 Giả định

- Bảng `meeting_minutes`, `transcripts`, `background_jobs`, `system_configs`, `audit_logs` đã tồn tại trong DB baseline v3.2 Compact; **không tạo bảng mới**.
- Quy tắc từ UC-MKM-01 vẫn áp dụng: mỗi meeting chỉ có tối đa MỘT bản ghi `meeting_minutes` đang hoạt động; "đang hoạt động (active)" được định nghĩa chính xác là **`deleted_at IS NULL`** (cùng predicate `deletedAt: IsNull()` mà UC-MKM-01 đang dùng trong service).
- Transcript đầu vào do pipeline STT nội bộ sinh ra, đã ở trạng thái hoàn tất (không phải `processing`/`failed`/`hidden`). Transcript `status = draft` (STT vừa xong, chưa người review) là **input hợp lệ** — Host review cả transcript lẫn minutes một lượt khi duyệt bản nháp (quyết định 2026-07-07).
- Ollama runtime và model Qwen2.5-Instruct được vận hành như một internal HTTP service trong private network; backend không có nhu cầu outbound internet khi chạy job.
- Với cấu hình local hiện tại (audio tối đa 300 giây), transcript đủ ngắn để xử lý **một lần gọi LLM duy nhất** (single-pass), không cần chunking nhiều bước trong MVP.
- Provider `mock` (trả kết quả giả lập đúng schema) được dùng cho test/dev khi chưa có Ollama.
- Meeting chỉ có một Host duy nhất (`meetings.host_id`); **không có khái niệm co-host/delegate** trong v1.

### 1.5 Cần làm rõ

- [RESOLVED 2026-07-07 — benchmark T018, xem plan.md mục 14] Size model và `maxInputTokens` đã chốt: dùng `qwen2.5:3b-instruct` trên máy dev yếu (7B thiếu RAM), giữ `maxInputTokens=6000`. Inference warm ~32s / cold ~104s, timeout 5 phút đủ headroom.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host (Internal Employee là `meetings.host_id`) | Primary actor | Tạo AI draft job cho meeting của mình; review/sửa/ban hành bản nháp (các feature minutes hiện có) |
| System Admin | Secondary actor | Tạo AI draft job cho mọi meeting (hỗ trợ vận hành); bật/tắt feature flag qua `system_configs` |
| AI Worker Summary (system) | System actor | BullMQ processor trong NestJS: consume job, gọi LLM runtime nội bộ qua HTTP, validate output, ghi kết quả |

### 2.2 Role & Permission Rules

- Permission code mới: `meeting.minutes.ai_draft.create` (theo convention `meeting.minutes.*` của seed hiện có).
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` — đây là các `role_code` **chính xác** trong bảng `roles`, đã xác minh khớp với seed `SeedMeetingMinutesCreatePermission` hiện có (2026-07-07).
- Seed permission mới là **file seed riêng** trong `src/database/seeds/` theo đúng pattern `SeedMeetingMinutesCreatePermission.ts` (không gộp vào seed của UC-MKM-01).
- Permission là điều kiện cần nhưng chưa đủ: hệ thống kiểm tra thêm **resource ownership** — người gọi phải là Host của chính meeting đó, trừ `SYSTEM_ADMIN`.
- Cấu hình feature flag (`system_configs`) chỉ `SYSTEM_ADMIN` được sửa (dùng cơ chế system-configs hiện có, không tạo endpoint mới).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập (JWT) và có permission `meeting.minutes.ai_draft.create`.
- Người dùng không phải Host của meeting (và không phải System Admin) không được tạo AI draft job cho meeting đó. Không có ngoại lệ cho co-host/organizer/participant.
- `SYSTEM_ADMIN` chỉ được **bypass resource ownership check**; mọi điều kiện khác (meeting tồn tại, transcript hợp lệ, feature flag bật, quy tắc conflict FR-010/FR-011) vẫn áp dụng đầy đủ.
- Participant thường chỉ được xem bản nháp theo quy tắc visibility của các feature minutes hiện có; feature này không mở rộng quyền xem.

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

- **FR-001**: THE system SHALL chỉ tạo biên bản AI ở trạng thái `status = draft`; không bao giờ tự động ban hành (publish) biên bản do AI sinh ra.
- **FR-002**: THE system SHALL chỉ sử dụng LLM self-hosted trong private network để xử lý transcript; không gửi nội dung transcript tới bất kỳ external API nào.
- **FR-003**: THE system SHALL lưu kết quả AI có cấu trúc vào bản ghi `meeting_minutes` như sau: phần tóm tắt tổng quan vào `minutes_content`, danh sách quyết định vào `decisions_json`, danh sách action items vào `action_items_json`, và phần metadata AI còn lại (keyPoints, risks, openQuestions, uncertainParts, thông tin model/job) vào cột mới `ai_summary_json`.
- **FR-004**: THE system SHALL tuân thủ quy tắc một bản ghi `meeting_minutes` active duy nhất cho mỗi meeting (kế thừa FR-001 của UC-MKM-01; active = `deleted_at IS NULL`).
- **FR-005**: THE system SHALL gán `prepared_by = <userId của người tạo job>` và `linked_transcript_id = <transcriptId đầu vào>` cho bản nháp AI được tạo.
- **FR-006**: THE system SHALL yêu cầu output của LLM tuân thủ đúng JSON schema đã chốt (xem mục 5.3) và validate schema trước khi ghi bất kỳ dữ liệu nào vào `meeting_minutes`.

### 3.2 Event-driven Requirements

- **FR-007**: WHEN Host/System Admin gửi request hợp lệ tới endpoint `POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs`, THE system SHALL tạo bản ghi `background_jobs` với `job_type = ai_meeting_summary` (bổ sung giá trị mới vào TS enum `BackgroundJobType` hiện có — cột DB là varchar, không cần migration), `queue_name = minutes.generate_ai_draft`, `related_entity_type = 'meeting'`, `related_entity_id = <meetingId>`, `requested_by = <userId>`, lưu tham số đầu vào (transcriptId, language, forceRerun) vào `input_json`, đẩy job vào queue và trả về HTTP 202 kèm `jobId`.
- **FR-008**: WHEN AI Worker Summary xử lý job thành công và output đã qua validation, THE system SHALL tạo bản ghi `meeting_minutes` mới (hoặc ghi đè bản nháp AI cũ theo FR-016) và cập nhật `background_jobs.status = completed` + `output_json = { minutesId, meetingId, status: 'draft' }` trong **cùng MỘT database transaction** (cùng EntityManager — hai bảng cùng PostgreSQL). Client theo dõi qua endpoint `GET /api/v1/background-jobs/:jobId` hiện có (đã trả `result` từ `output_json` khi completed, nên FE lấy được `minutesId` để điều hướng).
- **FR-009**: WHEN AI draft được tạo/ghi đè thành công, THE system SHALL ghi audit log gồm actor, action (`minutes.ai_draft.generated`), meetingId, transcriptId, jobId và timestamp.
- **FR-010**: WHEN người dùng gửi request với `forceRerun = false` (mặc định) và meeting đã có bản ghi `meeting_minutes` active (`deleted_at IS NULL`), THE system SHALL từ chối request với lỗi conflict, không tạo job.

### 3.3 State-driven Requirements

- **FR-011**: WHILE một AI draft job của cùng meeting đang ở trạng thái `queued`, `running` hoặc `retrying`, THE system SHALL từ chối request tạo job mới cho meeting đó. Kiểm tra dedup thực hiện trên `background_jobs` theo điều kiện `related_entity_type = 'meeting'` AND `related_entity_id = <meetingId>` AND `job_type = 'ai_meeting_summary'` AND `status IN (queued, running, retrying)` — dùng index `ix_background_jobs_related` hiện có, không query vào `input_json`.
- **FR-012**: WHILE transcript đầu vào chưa ở trạng thái hoàn tất (`status` không thuộc `draft`/`reviewed`/`approved`), THE system SHALL từ chối tạo AI draft job. Transcript `status = draft` là input hợp lệ (quyết định 2026-07-07) — không yêu cầu người review transcript trước khi dùng AI.
- **FR-013**: WHILE bản nháp AI đang chờ review, THE system SHALL giữ nguyên hành vi review/sửa/ban hành của các feature minutes hiện có (feature này không thay đổi luồng publish).

### 3.4 Optional Feature Requirements

- **FR-014**: WHERE cấu hình `ai.minutes_summary` không tồn tại trong `system_configs` HOẶC `config_json.enabled = false`, THE system SHALL từ chối mọi request tạo AI draft job với lỗi nghiệp vụ rõ ràng (fail-safe: thiếu config đồng nghĩa tắt).
- **FR-015**: WHERE cấu hình `ai.minutes_summary.provider = mock`, THE system SHALL dùng provider giả lập trả kết quả đúng schema (phục vụ test/dev không cần GPU/Ollama), và ghi rõ tên provider/model vào `ai_summary_json`.
- **FR-016**: WHERE request có `forceRerun = true` và bản ghi `meeting_minutes` active hiện tại là bản nháp do AI sinh ra (có `ai_summary_json` khác NULL) và vẫn ở `status = draft`, THE system SHALL cho phép tạo job mới; khi job hoàn thành, ghi đè bằng **UPDATE tại chỗ** trên bản ghi hiện có (không giữ lại nội dung cũ), tăng `version_no` thêm 1, và cập nhật `prepared_by = <userId của người trigger rerun>` (người chịu trách nhiệm nội dung mới — quyết định 2026-07-07).

### 3.5 Unwanted Behavior Requirements

- **FR-017**: IF transcript có `security_status` thuộc `restricted` hoặc `blocked`, THEN THE system SHALL từ chối tạo AI draft job và không đưa nội dung transcript vào bất kỳ prompt nào (`pending_scan` và `safe` được phép — chưa có scanner thật nên `pending_scan` là trạng thái phổ biến).
- **FR-018**: IF LLM runtime không phản hồi hoặc lỗi/timeout, THEN THE system SHALL xử lý theo retry policy: job được enqueue với `attempts = 2` (1 lần retry, backoff theo default `BULL_DEFAULT_BACKOFF_DELAY_MS` của queue module hiện có); hết retry thì đánh dấu job `failed`, giữ nguyên dữ liệu `transcripts` và `meeting_minutes` hiện có, không ghi kết quả một phần.
- **FR-019**: IF output của LLM không parse được thành JSON hợp lệ hoặc sai schema, THEN THE system SHALL thực hiện tối đa MỘT lần repair-prompt (nội dung repair gồm: output lỗi + error message cụ thể + schema yêu cầu; template chi tiết định nghĩa ở plan.md); nếu vẫn sai, đánh dấu job `failed` NGAY (non-retryable — không dùng retry của FR-018, theo pattern `isNonRetryableError` của transcription worker hiện có), không ghi dữ liệu vào `meeting_minutes`.
- **FR-020**: IF request có `forceRerun = true` nhưng bản ghi minutes active hiện tại KHÔNG phải bản nháp AI (soạn thủ công, `ai_summary_json` là NULL) hoặc đã `published`, THEN THE system SHALL từ chối request để bảo vệ nội dung do con người soạn/đã ban hành.
- **FR-021**: IF thông tin trong transcript không đủ để xác định quyết định, deadline hoặc người phụ trách, THEN THE system SHALL yêu cầu (qua prompt) LLM ghi giá trị `"Không xác định"` hoặc `confidence = low` thay vì suy diễn/bịa nội dung, và phần transcript mơ hồ phải được đưa vào `uncertainParts`. Đây là ràng buộc best-effort qua prompt; phần enforce được bằng code là schema validation (FR-006). Phát hiện hallucination nội dung nằm ngoài scope (mục 8).

### 3.6 Authorization Requirements

- **FR-022**: IF người dùng chưa đăng nhập, THEN THE system SHALL từ chối truy cập endpoint tạo AI draft job.
- **FR-023**: IF người dùng không có permission `meeting.minutes.ai_draft.create`, THEN THE system SHALL từ chối request và không tạo job.
- **FR-024**: IF người dùng có permission nhưng không phải Host của meeting và không phải System Admin, THEN THE system SHALL từ chối request và không tạo job.

### 3.7 Observability & Data Protection Requirements

- **FR-025**: THE system SHALL NOT ghi raw transcript, cleaned transcript, nội dung prompt đầy đủ hoặc nội dung summary vào application log; log chỉ được chứa jobId, meetingId, transcriptId, status, duration và errorCode.
- **FR-026**: WHEN job chuyển trạng thái (queued/running/completed/failed/retrying), THE system SHALL cập nhật trạng thái tương ứng trong `background_jobs`; khi job `failed`, error code + message rút gọn được ghi vào `background_jobs.error_message` (client đọc qua field `errorMessage` của endpoint poll hiện có).

### 3.8 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001, FR-021 | Ubiquitous / Unwanted | PDF mục 2.3, 5.2 (draft-only, human review, không bịa) | Nguyên tắc output AI |
| FR-002, FR-017, FR-025 | Ubiquitous / Unwanted | PDF mục 5.1 (bảo mật) | Self-hosted, không log nhạy cảm |
| FR-003 | Ubiquitous | Quyết định chốt #1 (2026-07-06) | Cột mới `ai_summary_json` |
| FR-004, FR-010, FR-016, FR-020 | Ubiquitous / Event / Optional / Unwanted | UC-MKM-01 FR-001 + PDF mục 3.4 (`forceRerun`) + quyết định 2026-07-07 (UPDATE tại chỗ, prepared_by) | Tương tác với quy tắc 1 minutes/meeting |
| FR-007, FR-008, FR-026 | Event-driven | PDF mục 3.3, 3.4, 4.1 + xác minh code 2026-07-07 | Job async qua BullMQ + background_jobs; endpoint poll đã tồn tại |
| FR-009 | Event-driven | PDF mục 5.1, 9 | Audit bắt buộc |
| FR-011, FR-012 | State-driven | PDF mục 8, 9 + quyết định 2026-07-07 (transcript draft hợp lệ) | Dedupe qua related_entity index |
| FR-014, FR-015 | Optional Feature | PDF mục 4.2, 7.1 (feature flag, MockLlmProvider) | Fail-safe khi thiếu config |
| FR-018, FR-019 | Unwanted | PDF mục 4.5, 8 + pattern transcription worker | attempts=2, repair 1 lần, non-retryable |
| FR-022 → FR-024 | Authorization | PDF mục 5.3 + convention seed permission | `meeting.minutes.ai_draft.create` |

---

## 4. Non-functional Requirements

### 4.1 Performance

- **NFR-001**: THE system SHALL trả response cho request tạo AI draft job (HTTP 202) trong vòng 2 giây trong điều kiện tải bình thường; toàn bộ xử lý LLM diễn ra bất đồng bộ trong worker.
- **NFR-002**: THE system SHALL giới hạn concurrency của AI summary job ở mức 1 job tại một thời điểm (chạy tuần tự với STT job, không tranh tài nguyên trên máy local/single-GPU).
- **NFR-003**: THE system SHALL áp dụng timeout cho một lần gọi LLM, cấu hình qua env `AI_SUMMARY_LLM_TIMEOUT_MS` (mặc định `300000` ms — 5 phút, theo pattern `AI_WORKER_JOB_TIMEOUT_MS` của transcription worker); job vượt timeout được xử lý theo FR-018.

### 4.2 Security

- **NFR-004**: THE system SHALL yêu cầu authentication (JWT) và authorization (RBAC + resource ownership) cho endpoint tạo AI draft job.
- **NFR-005**: THE system SHALL vận hành LLM runtime trong private network, không yêu cầu outbound internet tại runtime; model được preload trước (image/volume).
- **NFR-006**: THE system SHALL ghi nhận policy retention 90 ngày cho dữ liệu vận hành AI (input/output_json của job) qua `config_json.retentionDays` trong `system_configs`; cơ chế cleanup tự động là **maintenance feature riêng, ngoài scope feature này** (quyết định 2026-07-07, xem mục 8).
- **NFR-007**: THE system SHALL NOT trả nội dung transcript trong response của endpoint tạo job (response chỉ chứa jobId, meetingId, status).

### 4.3 Reliability & Consistency

- **NFR-008**: THE system SHALL ghi kết quả job (tạo/ghi đè `meeting_minutes` + cập nhật `background_jobs`) trong cùng một database transaction (cùng EntityManager); nếu ghi thất bại, không để lại dữ liệu một phần.
- **NFR-009**: IF job thất bại ở bất kỳ bước nào, THEN THE system SHALL giữ nguyên transcript và bản minutes hiện có (nếu có), không làm hỏng dữ liệu cũ.

### 4.4 Observability

- **NFR-010**: THE system SHALL ghi log lỗi xử lý quan trọng của feature này với errorCode phân loại được (không chứa nội dung nhạy cảm, theo FR-025).
- **NFR-011**: THE system SHALL ghi audit log cho hành động tạo AI draft (theo FR-009); hành động sửa/ban hành đã được audit bởi các feature minutes hiện có.

### 4.5 Maintainability

- **NFR-012**: THE system SHALL tách phần gọi LLM ra sau một provider interface để có thể thay provider (mock/self-hosted) qua cấu hình mà không đổi business logic, và để mở rộng RAG/provider khác ở phase sau.
- **NFR-013**: THE system SHALL cung cấp test cho: happy path (với mock provider), validation lỗi, từ chối authorization, feature flag tắt, output sai schema, và LLM không phản hồi. Yêu cầu tầng test cụ thể: (a) schema validator của AI output có **unit test riêng với fixtures output sai** (không chỉ test gián tiếp qua mock provider), (b) happy path là integration test với MockLlmProvider, (c) kiểm tra log không chứa nội dung nhạy cảm được automated bằng Jest spy trên Logger.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `transcripts` | Nguồn dữ liệu đầu vào (raw_text/cleaned_text, status, security_status) | Chỉ đọc |
| `meeting_minutes` | Nơi lưu bản nháp AI (minutes_content, decisions_json, action_items_json, **ai_summary_json** mới) | Tạo/ghi đè bản draft |
| `background_jobs` | Theo dõi job async (job_type, queue_name, related_entity_*, status, input_json, output_json, error_message) | Tạo + cập nhật |
| `system_configs` | Feature flag + cấu hình AI (`ai.minutes_summary`) | Chỉ đọc trong feature này |
| `audit_logs` | Truy vết hành động tạo AI draft | Ghi |
| `meetings` | Kiểm tra tồn tại + resource ownership (host_id) | Chỉ đọc |

### 5.2 Thay đổi schema & dữ liệu khởi tạo được phê duyệt trong spec này

> Thay đổi schema DUY NHẤT là cột `ai_summary_json`, đã được Product Owner chốt ngày 2026-07-06. Không tạo bảng mới.

#### 5.2.1 Migration & thay đổi code-level

| Thay đổi | Loại | Chi tiết |
|---|---|---|
| Thêm cột `ai_summary_json` vào `meeting_minutes` | **DB migration** | `jsonb`, nullable. NULL = biên bản soạn thủ công; khác NULL = bản nháp có nguồn gốc AI (dùng cho FR-016/FR-020). File migration theo convention hiện có: `20260707XXXXXX-AddAiSummaryJsonToMeetingMinutes.ts` trong `src/database/migrations/`. |
| Thêm `AI_MEETING_SUMMARY = 'ai_meeting_summary'` vào enum `BackgroundJobType` | Code-only (TS enum) | Cột `background_jobs.job_type` là `varchar(80)`, KHÔNG phải DB enum — không cần migration. |
| Seed permission `meeting.minutes.ai_draft.create` | Seed file riêng | Theo pattern `SeedMeetingMinutesCreatePermission.ts`, gán cho 4 role codes ở mục 2.2. |
| Seed `system_configs` key `ai.minutes_summary` | Seed file riêng | Defaults ở mục 5.2.2. |

**Các cột sau ĐÃ TỒN TẠI SẴN trong schema, liệt kê để tránh hiểu nhầm là schema change** (xác minh entity 2026-07-07): `meeting_minutes.version_no` (integer, default 1), `meeting_minutes.linked_transcript_id`, `meeting_minutes.prepared_by`, `background_jobs.related_entity_type/related_entity_id` (có index `ix_background_jobs_related`), `background_jobs.error_message`, `transcripts.security_status`.

#### 5.2.2 Seed `system_configs` — key `ai.minutes_summary`

```json
{
  "configKey": "ai.minutes_summary",
  "configJson": {
    "enabled": false,
    "provider": "mock",
    "modelName": "qwen2.5-instruct",
    "allowExternalProvider": false,
    "requireHumanReview": true,
    "maxInputTokens": 6000,
    "temperature": 0.2,
    "retentionDays": 90,
    "logRawTranscript": false
  }
}
```

- `enabled` mặc định `false` — bật thủ công khi demo (fail-safe theo FR-014).
- `provider`: `mock | self_hosted_llm`. `maxInputTokens` là ngưỡng cho ERR-010, giá trị tinh chỉnh ở plan.md.
- Nếu key không tồn tại lúc runtime → hệ thống xử lý như `enabled = false` (FR-014), không throw unhandled error.

### 5.3 JSON Schema output của AI (chốt cho cả BE và FE)

> Schema này là contract chính thức để FE dựng UI review sau này (quyết định chốt #7). Mọi thay đổi schema phải cập nhật spec này trước.

Phân bổ vào `meeting_minutes`:

| Phần output AI | Lưu vào |
|---|---|
| `summary` (string) | `minutes_content` |
| `decisions` (array) | `decisions_json` |
| `actionItems` (array) | `action_items_json` |
| `keyPoints`, `risks`, `openQuestions`, `uncertainParts`, `meta` | `ai_summary_json` |

Cấu trúc đầy đủ output LLM phải trả về:

```json
{
  "summary": "string",
  "keyPoints": ["string"],
  "decisions": [
    {
      "text": "string",
      "confidence": "high | medium | low",
      "evidence": "string | Không xác định"
    }
  ],
  "actionItems": [
    {
      "task": "string",
      "owner": "string | Không xác định",
      "deadline": "string | Không xác định",
      "confidence": "high | medium | low"
    }
  ],
  "risks": ["string"],
  "openQuestions": ["string"],
  "uncertainParts": ["string"]
}
```

Cấu trúc `ai_summary_json` lưu trong DB (phần AI worker tự bổ sung `meta`):

```json
{
  "keyPoints": ["string"],
  "risks": ["string"],
  "openQuestions": ["string"],
  "uncertainParts": ["string"],
  "meta": {
    "provider": "self_hosted_llm | mock",
    "modelName": "string",
    "promptVersion": "string",
    "generatedByJobId": "uuid",
    "generatedAt": "ISO-8601 timestamp"
  }
}
```

- `meta.promptVersion`: hằng số gắn với prompt template trong code (giá trị khởi điểm `mvp-v1`), **bump thủ công** mỗi khi template prompt thay đổi — phục vụ tracing khi chất lượng output đổi theo prompt.

### 5.4 API contract — tạo AI draft job

**Endpoint**: `POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` → HTTP 202 Accepted.

Request body:

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `transcriptId` | uuid | Có | Transcript nguồn, phải thuộc đúng `meetingId` trong path | UUID hợp lệ, tồn tại, thuộc meeting, status hoàn tất (FR-012), security_status hợp lệ (FR-017) |
| `language` | string | Không | Ngôn ngữ output, mặc định `vi-VN` | Allowlist MVP: **chỉ `vi-VN`** (quyết định 2026-07-07; `en-US` là mở rộng sau, xem mục 8). Param giữ lại cho forward-compat. |
| `forceRerun` | boolean | Không | Cho phép ghi đè bản nháp AI cũ (FR-016/FR-020) | Mặc định `false` |

### 5.5 Dữ liệu đầu ra (response tạo job — HTTP 202)

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `jobId` | uuid | ID bản ghi `background_jobs` để theo dõi qua `GET /api/v1/background-jobs/:jobId` |
| `meetingId` | uuid | Meeting liên quan |
| `status` | string | `queued` |

Không có field `estimatedDurationSeconds` — thời gian inference biến động lớn theo phần cứng, không ước tính trung thực được; FE hiển thị trạng thái qua polling (quyết định 2026-07-07).

### 5.6 State / Status Model

Trạng thái job (dùng enum `BackgroundJobStatus` hiện có, không thêm giá trị mới):

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| `queued` | Job đã tạo, chờ worker | `running` | Worker nhận job |
| `running` | Worker đang gọi LLM/validate | `completed`, `failed`, `retrying` | Kết quả xử lý |
| `retrying` | Lỗi tạm thời (LLM_UNAVAILABLE), chờ retry (tối đa 1 lần — attempts=2) | `running`, `failed` | Retry policy FR-018 |
| `completed` | Draft đã ghi thành công, `output_json = { minutesId, ... }` | — | Terminal |
| `failed` | Lỗi không phục hồi; error code trong `error_message` | — | Terminal |

Bản ghi `meeting_minutes` do AI tạo luôn ở `status = draft`; chuyển trạng thái tiếp theo (publish/archive) thuộc các feature minutes hiện có.

### 5.7 Data Constraints

- Một meeting chỉ có một `meeting_minutes` active (`deleted_at IS NULL`), kế thừa UC-MKM-01.
- `linked_transcript_id` phải trỏ tới transcript thuộc đúng meeting.
- Không xóa/sửa transcript trong feature này (chỉ đọc).
- `ai_summary_json.meta.generatedByJobId` phải trace về đúng `background_jobs.id` đã sinh nội dung.
- `version_no` khởi tạo `1` khi AI tạo lần đầu (default của entity hiện có); mỗi lần forceRerun thành công tăng thêm 1 (do service thực hiện, không có DB trigger).

### 5.8 Data Lifecycle

- Tạo: khi AI worker hoàn thành job thành công (FR-008).
- Cập nhật: khi `forceRerun` hợp lệ — UPDATE tại chỗ, nội dung cũ không được giữ lại, `version_no` +1, `prepared_by` đổi theo người trigger (FR-016); hoặc Host sửa tay qua feature update-draft hiện có.
- Xóa mềm: theo feature delete-draft hiện có, ngoài phạm vi feature này.
- Retention: policy 90 ngày ghi trong config (NFR-006); cleanup tự động là feature riêng.

### 5.9 Cần làm rõ

- [NEEDS CLARIFICATION] Vị trí chính xác và shape của `decisions_json`/`action_items_json` khi FE hiển thị chung với minutes soạn tay (UC-MKM-01 khởi tạo các cột này NULL) — xác nhận với FE khi dựng UI review, không chặn BE.

---

## 6. Error Handling

### 6.1 Validation Errors

- **ERR-001**: IF `transcriptId` thiếu hoặc không phải UUID hợp lệ, THEN THE system SHALL từ chối request với lỗi validation (HTTP 400).
- **ERR-002**: IF `language` không thuộc allowlist (MVP: chỉ `vi-VN`), THEN THE system SHALL từ chối request với lỗi validation (HTTP 400).

### 6.2 Authentication / Authorization Errors

- **ERR-003**: IF người dùng chưa đăng nhập, THEN THE system SHALL trả lỗi authentication (HTTP 401).
- **ERR-004**: IF người dùng không có permission `meeting.minutes.ai_draft.create` hoặc không phải Host/System Admin của meeting, THEN THE system SHALL trả lỗi authorization (HTTP 403), error code `PERMISSION_DENIED`.

### 6.3 Business Rule Errors

- **ERR-005**: IF meeting không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả HTTP 404, error code `MEETING_NOT_FOUND`.
- **ERR-006**: IF transcript không tồn tại hoặc không thuộc meeting, THEN THE system SHALL trả HTTP 404, error code `TRANSCRIPT_NOT_FOUND`.
- **ERR-007**: IF transcript chưa hoàn tất (FR-012), THEN THE system SHALL trả HTTP 422, error code `TRANSCRIPT_NOT_READY`.
- **ERR-008**: IF transcript có security_status `restricted`/`blocked` (FR-017), THEN THE system SHALL trả HTTP 403, error code `TRANSCRIPT_RESTRICTED`.
- **ERR-009**: IF feature flag đang tắt hoặc config không tồn tại (FR-014), THEN THE system SHALL trả HTTP 403, error code `AI_SUMMARY_DISABLED`.
- **ERR-010**: IF transcript vượt ngưỡng `maxInputTokens` cấu hình trong `system_configs.ai.minutes_summary` (mặc định 6000), THEN THE system SHALL đánh dấu job `failed` với error code `TRANSCRIPT_TOO_LONG_FOR_MVP` ghi vào `background_jobs.error_message` (không chặn ở API layer vì tính toán token diễn ra ở worker; non-retryable).

### 6.4 Conflict Errors

- **ERR-011**: IF meeting đã có `meeting_minutes` active và `forceRerun = false` (FR-010), THEN THE system SHALL trả HTTP 409, error code `MINUTES_ALREADY_EXISTS`.
- **ERR-012**: IF `forceRerun = true` nhưng minutes hiện tại không phải bản nháp AI hoặc đã published (FR-020), THEN THE system SHALL trả HTTP 409, error code `MINUTES_NOT_AI_DRAFT`.
- **ERR-013**: IF đã có AI draft job `queued`/`running`/`retrying` cho meeting (FR-011), THEN THE system SHALL trả HTTP 409, error code `AI_JOB_ALREADY_RUNNING`.

### 6.5 Integration Errors (trong worker, phản ánh qua job status)

- **ERR-014**: IF LLM runtime không phản hồi/timeout theo `AI_SUMMARY_LLM_TIMEOUT_MS` (FR-018), THEN THE system SHALL đánh dấu job `retrying` (còn attempts) hoặc `failed` (hết attempts) với error code `LLM_UNAVAILABLE` trong `error_message`.
- **ERR-015**: IF output LLM sai schema sau 1 lần repair (FR-019), THEN THE system SHALL đánh dấu job `failed` (non-retryable) với error code `AI_OUTPUT_INVALID_SCHEMA` trong `error_message`.

### 6.6 Error Response Expectations

- Lỗi tại API layer: theo exception filter chung của dự án — `success=false`, `message`, `error.code`, `error.details`, `timestamp`, `path`.
- Lỗi trong worker: không có HTTP response — phản ánh qua `background_jobs.status = failed` + error code/message rút gọn trong `background_jobs.error_message` (không chứa nội dung transcript); client đọc qua field `errorMessage` của `GET /api/v1/background-jobs/:jobId` (DTO hiện có đã expose field này).

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given Host đã đăng nhập, có permission meeting.minutes.ai_draft.create, meeting của mình có transcript status=draft và chưa có meeting_minutes active, feature flag đang bật (provider=mock),
When Host gửi POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs với transcriptId hợp lệ,
Then hệ thống trả 202 kèm jobId; job chạy và hoàn thành; tồn tại bản ghi meeting_minutes mới với status=draft, version_no=1, prepared_by=Host, linked_transcript_id đúng, minutes_content chứa summary, decisions_json/action_items_json/ai_summary_json đúng schema mục 5.3; background_jobs.status=completed và output_json chứa minutesId.
```

### 7.2 Validation Cases

```text
AC-002:
Given request thiếu transcriptId hoặc transcriptId không phải UUID,
When Host gửi request,
Then hệ thống trả 400 validation error, không tạo background_jobs record.
```

### 7.3 Authorization Cases

```text
AC-003:
Given người dùng có permission nhưng không phải Host của meeting và không phải System Admin,
When người đó gửi request tạo AI draft job,
Then hệ thống trả 403 PERMISSION_DENIED, không tạo job.
```

### 7.4 Business Rule Cases

```text
AC-004:
Given feature flag ai.minutes_summary.enabled=false (hoặc config key không tồn tại),
When Host gửi request hợp lệ,
Then hệ thống trả 403 AI_SUMMARY_DISABLED, không tạo job.

AC-005:
Given transcript đang ở status=processing,
When Host gửi request,
Then hệ thống trả 422 TRANSCRIPT_NOT_READY, không tạo job.

AC-006:
Given meeting đã có meeting_minutes active soạn thủ công (ai_summary_json IS NULL),
When Host gửi request với forceRerun=true,
Then hệ thống trả 409 MINUTES_NOT_AI_DRAFT, bản minutes thủ công không bị thay đổi.
```

### 7.5 State Transition / Rerun Cases

```text
AC-007:
Given meeting đã có bản nháp AI (ai_summary_json khác NULL, status=draft) với version_no=1, prepared_by=Host A,
When System Admin gửi request với forceRerun=true và job hoàn thành,
Then bản ghi meeting_minutes hiện có được UPDATE tại chỗ với nội dung mới, version_no=2, prepared_by=System Admin, vẫn status=draft (không có bản ghi minutes thứ hai).

AC-008:
Given một AI draft job của meeting đang ở trạng thái running,
When Host gửi thêm request tạo job cho cùng meeting,
Then hệ thống trả 409 AI_JOB_ALREADY_RUNNING, không tạo job thứ hai.
```

### 7.6 Failure / Safety Cases

```text
AC-009:
Given LLM runtime không phản hồi (mock lỗi/timeout),
When job chạy,
Then job retry đúng 1 lần (attempts=2); nếu vẫn lỗi, background_jobs chuyển failed với error_message chứa LLM_UNAVAILABLE; không có bản ghi meeting_minutes mới; transcript không đổi.

AC-010:
Given LLM trả output sai schema cả lần đầu lẫn sau 1 lần repair-prompt,
When job chạy,
Then background_jobs.status=failed NGAY (không retry) với error_message chứa AI_OUTPUT_INVALID_SCHEMA; không có dữ liệu nào được ghi vào meeting_minutes.

AC-011:
Given job chạy hoàn tất (thành công hoặc thất bại),
When kiểm tra application log (automated: Jest spy trên Logger của processor/provider),
Then log không chứa raw transcript, cleaned transcript, prompt đầy đủ hay nội dung summary — chỉ có jobId, meetingId, transcriptId, status, duration, errorCode.
```

### 7.7 Audit Cases

```text
AC-012:
Given AC-001 hoàn thành,
When kiểm tra audit_logs,
Then tồn tại bản ghi audit với actor=Host, action=minutes.ai_draft.generated, đúng meetingId/transcriptId/jobId.
```

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-003, FR-005 → FR-008, FR-015 | Happy path với mock provider (integration test) |
| AC-002 | ERR-001 | Validation transcriptId |
| AC-003 | FR-023, FR-024, ERR-004 | Không phải Host |
| AC-004 | FR-014, ERR-009 | Feature flag tắt / thiếu config |
| AC-005 | FR-012, ERR-007 | Transcript chưa xong |
| AC-006 | FR-020, ERR-012 | Bảo vệ minutes thủ công |
| AC-007 | FR-016 | forceRerun UPDATE tại chỗ, version_no 1→2, prepared_by đổi |
| AC-008 | FR-011, ERR-013 | Dedupe job qua related_entity |
| AC-009 | FR-018, ERR-014, NFR-009 | LLM down: retry 1 lần rồi fail an toàn |
| AC-010 | FR-006, FR-019, ERR-015 | Schema validation + repair 1 lần, non-retryable |
| AC-011 | FR-025, NFR-013 | Không log nhạy cảm (automated logger spy) |
| AC-012 | FR-009, NFR-011 | Audit log |

**Ghi chú tầng test (giải đáp AC-01 clarify)**: schema validation của AI output KHÔNG chỉ được test gián tiếp qua mock provider — validator phải có unit test riêng nhận fixtures JSON sai (thiếu field, sai enum confidence, thừa field ngoài schema, không parse được) và assert từ chối đúng; AC-001/AC-010 là integration test phủ luồng đầy đủ (NFR-013).

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- RAG dưới mọi hình thức (attachment, meeting cũ, knowledge base, embedding, vector search, pgvector, bảng `rag_*`).
- Fine-tuning model hoặc thu thập dataset training.
- Tự động trigger AI draft khi transcript hoàn tất (đã chốt: user-triggered only).
- Chunking nhiều bước cho transcript dài (MVP single-pass; transcript quá dài → ERR-010).
- Gọi external LLM API (OpenAI, Anthropic, Google...) cho transcript thật.
- UI review trên FE (FE dựng sau dựa trên schema mục 5.3).
- Notification/email/WebSocket thông báo khi draft sẵn sàng (client poll qua `GET /api/v1/background-jobs/:jobId`; realtime là enhancement sau). Không thêm `estimatedDurationSeconds` vào 202 response.
- **Cơ chế cleanup tự động cho retention 90 ngày** (cron/scheduled job) — maintenance feature riêng; feature này chỉ ghi policy vào config (quyết định 2026-07-07).
- **Hỗ trợ ngôn ngữ output `en-US`** — MVP chỉ `vi-VN`; prompt template en-US và AC tương ứng làm khi mở rộng.
- **Cơ chế phát hiện hallucination nội dung** (LLM bịa owner/deadline bất chấp prompt) — FR-021 là best-effort qua prompt + schema validation; post-hoc detection là enhancement sau.
- Khái niệm co-host/delegate được ủy quyền tạo AI draft.
- Lưu lịch sử nội dung bản nháp AI cũ khi forceRerun (đã chốt UPDATE tại chỗ, không giữ history).
- Thay đổi luồng review/update/publish/delete minutes (dùng các feature minutes hiện có).
- Bật lại pyannote diarization/overlap detection hoặc gán owner action item theo người nói.
- Sửa đổi pipeline STT hiện tại.

### 8.1 Không triển khai trong feature này

- Không thêm bảng mới; thay đổi schema duy nhất là cột `ai_summary_json` (mục 5.2).
- Không thêm endpoint quản trị cấu hình AI riêng (dùng cơ chế system-configs hiện có).
- Không xây dựng cơ chế redact/ẩn thông tin nhạy cảm trong transcript trước khi đưa vào prompt (chấp nhận rủi ro vì chạy fully on-prem; xem xét sau).

### 8.2 Có thể xem xét ở feature khác

- `feat-rag-meeting-attachment-context`: RAG trên attachment của meeting (Phase 2 theo tài liệu định hướng, có spec + migration riêng). Điểm mở rộng: provider interface (NFR-012) thiết kế sẵn chỗ nhận context bổ sung, chi tiết ở plan.md.
- Maintenance feature: cleanup retention cho `background_jobs` (input/output_json quá 90 ngày).
- Chunking + merge nhiều bước cho meeting dài.
- Notification khi AI draft sẵn sàng.
- Hỗ trợ đa ngôn ngữ output (en-US).
- Đánh giá chất lượng summary (human feedback loop) làm tiền đề fine-tuning (Phase 4).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement RAG, embedding, vector search hoặc bảng rag_* trong feature này.
OOS-002: THE system SHALL NOT tạo bảng database mới; thay đổi schema duy nhất được phê duyệt là cột meeting_minutes.ai_summary_json.
OOS-003: THE system SHALL NOT gửi nội dung transcript tới external LLM API trong feature này.
OOS-004: THE system SHALL NOT tự động publish biên bản AI hoặc thay đổi luồng publish của các feature minutes hiện có.
OOS-005: WHERE tài liệu định hướng nhắc tới fine-tuning/RAG như phase tương lai cho ngữ cảnh, THE system SHALL NOT triển khai các phần đó trong feature này.
OOS-006: THE system SHALL NOT implement cơ chế cleanup retention tự động trong feature này (maintenance feature riêng).
```
