# Implementation Plan: AI Meeting Minutes Draft (MKM-AI-01)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-07 | T018 benchmark thật + chốt model: đo trên máy dev (16GB RAM, ~2.9GB free, Intel Iris Xe iGPU, KHÔNG có dGPU) → **model chọn `qwen2.5:3b-instruct`** thay vì 7B (7B skip vì free RAM không đủ). Bổ sung mục 14 (Benchmark T018). Đóng NEEDS CLARIFICATION duy nhất của spec 1.5. Phát hiện quan trọng: model 3B ban đầu trả `confidence` là SỐ (1/0.95) làm fail schema validation → đã tăng cường prompt (rule bắt buộc confidence là chuỗi + ví dụ few-shot) → smoke test PASS | Mục 14 (mới), 2.1 |
| 2026-07-07 | Khởi tạo plan cho feat-ai-meeting-minutes-draft dựa trên spec.md (bản 2026-07-07 đã giải quyết toàn bộ clarify). Chốt các quyết định kỹ thuật còn treo: model default `qwen2.5:7b-instruct`, Ollama native API với `format: json`, token heuristic chars/3, queue name mới đăng ký trong QueueModule, code đặt trong module `minutes` | Toàn bộ file |

**Branch**: `feat-ai-meeting-minutes-draft` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

---

## 1. Feature Summary

Bổ sung endpoint `POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` (202 Accepted) cho phép Host/System Admin tạo background job sinh bản nháp biên bản họp bằng LLM self-hosted từ transcript đã hoàn tất. Job chạy async qua BullMQ (processor trong NestJS, concurrency=1), gọi Ollama (Qwen2.5-Instruct) qua internal HTTP, validate output JSON theo schema chốt ở spec mục 5.3, rồi ghi `meeting_minutes` (status=draft) + `background_jobs` (completed, output_json chứa minutesId) trong cùng transaction, kèm audit log. Mock provider cho phép chạy end-to-end không cần Ollama.

## 2. Technical Context

### 2.1 Tech Stack

- NestJS + TypeORM + PostgreSQL + BullMQ/Redis — đúng baseline CLAUDE.md, không Prisma.
- LLM runtime: **Ollama** (container/process riêng, private network), model default **`qwen2.5:7b-instruct`** (chốt 7B thay vì 14B — máy dev yếu, đã tắt diarization để nhường tài nguyên; đổi model chỉ cần sửa `config_json.modelName`).
- Gọi Ollama qua native API `POST /api/chat` với option **`format: "json"`** (ép output JSON, giảm tỉ lệ sai schema so với prompt thuần).
- Không thêm thư viện mới: HTTP call dùng `fetch`/`HttpService` sẵn có; schema validation viết tay (pattern `schemas.py` của worker STT) — không thêm zod/ajv.

### 2.2 Existing Codebase Analysis (đã xác minh 2026-07-07)

| Thành phần có sẵn | Đường dẫn | Vai trò tái sử dụng |
|---|---|---|
| `QueueModule` (Global) + `QueueService.addJob()` | `src/modules/queue/` | Đăng ký queue mới + enqueue; default `attempts`/`backoff` exponential đã có |
| `TranscriptionWorkerProcessor` | `src/modules/transcription/transcription-worker.processor.ts` | Pattern chuẩn cho processor mới: `@Processor(QUEUE_NAME)` + `WorkerHost`, markRunning/markCompleted/markFailed, phân loại non-retryable error |
| `BackgroundJobsService` + `BackgroundJobEntity` | `src/modules/administration/` | Tạo/cập nhật job record; enum `BackgroundJobType` (TS enum, DB varchar) thêm giá trị mới; cột `related_entity_type/id`, `error_message` dùng sẵn |
| `GET /api/v1/background-jobs/:id` | `background-jobs.controller.ts` | Endpoint poll đã tồn tại, DTO trả `result` (=output_json) + `errorMessage` — không sửa gì |
| `MinutesService` / UC-MKM-01 | `src/modules/minutes/services/minutes.service.ts` | Pattern host-check, predicate active (`deletedAt: IsNull()`), transaction `dataSource.transaction`, lock meeting `FOR UPDATE` |
| `AuditLogsService.logAction()` | `src/modules/administration/services/audit-logs.service.ts` | Ghi audit |
| `SystemConfigEntity` | `src/modules/administration/entities/system-config.entity.ts` | Đọc config `ai.minutes_summary`; pattern đọc config tham khảo `dashboard-overview-config.service.ts` |
| Seed pattern | `seeds/20260702000001-SeedMeetingMinutesCreatePermission.ts`, `seeds/20260616000002-SeedCheckinAlertConfig.ts` | Template cho 2 seed mới (permission + system_configs) |

### 2.3 Patterns to Follow

- Controller: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.ai_draft.create')` + `@CurrentUser()`.
- Response `{ success, message, data }`; exception payload `{ success: false, message, error: { code, details } }`.
- Processor: check `job.name` prefix, phân loại lỗi non-retryable (fail ngay) vs retryable (throw để BullMQ retry) — y hệt transcription processor.
- Log: chỉ jobId/meetingId/transcriptId/status/duration/errorCode (FR-025).

### 2.4 Cấu hình mới

| Loại | Key | Default | Ghi chú |
|---|---|---|---|
| env | `QUEUE_MINUTES_AI_DRAFT` | `minutes.generate_ai_draft` | Tên BullMQ queue, đăng ký thêm entry trong `QueueModule.registerQueueAsync` (token `QUEUE_MINUTES_AI_DRAFT_NAME`) + constant tĩnh cho `@Processor` |
| env | `AI_SUMMARY_LLM_BASE_URL` | `http://localhost:11434` | Base URL Ollama (internal) |
| env | `AI_SUMMARY_LLM_TIMEOUT_MS` | `300000` | Timeout 1 lần gọi LLM (NFR-003) |
| system_configs | `ai.minutes_summary` | Seed theo spec 5.2.2 (`enabled=false`, `provider=mock`, `modelName=qwen2.5:7b-instruct`, `maxInputTokens=6000`, ...) | Runtime flag/config; thiếu key = tắt (FR-014) |

## 3. Scope Confirmation

### 3.1 In Scope

- 1 endpoint tạo AI draft job (202 + jobId).
- 1 BullMQ queue + processor mới (concurrency=1).
- Provider interface + `MockLlmProvider` + `OllamaLlmProvider`; `ContextRetrieverPort` trả context rỗng (chuẩn bị RAG phase sau, theo Phụ lục B tài liệu định hướng).
- Prompt builder (vi-VN, promptVersion `mvp-v1`) + output validator viết tay + repair-prompt 1 lần.
- 1 migration (`ai_summary_json`), 1 giá trị enum TS, 2 seed (permission, system_configs).
- Unit test + integration test theo NFR-013.

### 3.2 Out of Scope

Xem spec.md mục 8 (RAG, fine-tuning, auto-trigger, chunking, en-US, notification, retention cleanup, hallucination detection, FE UI...).

### 3.3 Constitution Gate Check

| Gate | Kết quả |
| :--- | :--- |
| DB Gate | PASS — 0 bảng mới; 1 cột mới `ai_summary_json` được phê duyệt tường minh trong spec 5.2 (Product Owner chốt 2026-07-06), có migration chuẩn |
| Security Gate | PASS — không credential trong code; Ollama URL/timeout qua env; không log transcript/prompt/summary (FR-025); transcript không rời private network |
| Scope Gate | PASS — Constitution III cấm "tự ý thêm AI pipeline", nhưng feature này có **yêu cầu tường minh của Product Owner** (spec + 12 quyết định chốt 2026-07-06/07) → không phải "tự ý"; scope khóa bằng OOS-001→006 |
| Module Gate | PASS — code nằm trong module `minutes`; tái sử dụng `queue`/`administration` qua service export sẵn có, không import chéo mới |
| API Gate | PASS — endpoint theo convention `/api/v1/meetings/:meetingId/minutes/ai-draft-jobs`, response format chuẩn, 202 cho async |
| Auth Gate | PASS — JwtAuthGuard + PermissionsGuard + ownership check; userId từ JWT |
| Test Gate | Áp dụng — mục 10 |

### 3.4 Complexity Tracking

Không có vi phạm principle nào cần justification. Điểm phức tạp duy nhất (external LLM runtime) được cô lập sau `LlmProviderPort` — mock được toàn bộ khi test.

## 4. Data Model Impact

### 4.1 Migration (1 file)

`src/database/migrations/20260707XXXXXX-AddAiSummaryJsonToMeetingMinutes.ts`:

```sql
ALTER TABLE meeting_minutes ADD COLUMN ai_summary_json jsonb NULL;
-- down: ALTER TABLE meeting_minutes DROP COLUMN ai_summary_json;
```

Entity update: thêm `@Column({ name: 'ai_summary_json', type: 'jsonb', nullable: true })` vào `MeetingMinutesEntity`.

### 4.2 Code-level (không phải DB change)

- `BackgroundJobType` thêm `AI_MEETING_SUMMARY = 'ai_meeting_summary'`.
- Constant `AI_MINUTES_QUEUE_NAME = 'minutes.generate_ai_draft'` (file constants trong module minutes).

### 4.3 Seeds (2 file)

1. `SeedMeetingMinutesAiDraftPermission.ts` — permission `meeting.minutes.ai_draft.create` (module_code=`minutes`, action_code=`minutes.ai_draft.create`), gán 4 role codes: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. Template: seed UC-MKM-01.
2. `SeedAiMinutesSummaryConfig.ts` — `system_configs` key `ai.minutes_summary` với config_json spec 5.2.2 (`ON CONFLICT DO NOTHING` để không đè config đã chỉnh tay).

### 4.4 Bảng bị INSERT/UPDATE lúc runtime

`background_jobs` (INSERT + UPDATE status/output_json/error_message), `meeting_minutes` (INSERT hoặc UPDATE khi forceRerun), `audit_logs` (INSERT). Chỉ đọc: `meetings`, `transcripts`, `system_configs`.

## 5. API / Contract Plan

### 5.1 Endpoint

`POST /api/v1/meetings/:meetingId/minutes/ai-draft-jobs` → `202 Accepted`

### 5.2 Request

```jsonc
{
  "transcriptId": "uuid, required",
  "language": "string, optional, allowlist ['vi-VN'], default vi-VN",
  "forceRerun": "boolean, optional, default false"
}
```

### 5.3 Success Response (202)

```jsonc
{
  "success": true,
  "message": "AI draft job queued",
  "data": { "jobId": "uuid", "meetingId": "uuid", "status": "queued" }
}
```

### 5.4 Error Responses

Theo spec mục 6: `400` ERR-001/002; `401`; `403 PERMISSION_DENIED | TRANSCRIPT_RESTRICTED | AI_SUMMARY_DISABLED`; `404 MEETING_NOT_FOUND | TRANSCRIPT_NOT_FOUND`; `409 MINUTES_ALREADY_EXISTS | MINUTES_NOT_AI_DRAFT | AI_JOB_ALREADY_RUNNING`; `422 TRANSCRIPT_NOT_READY`. Lỗi worker (LLM_UNAVAILABLE, AI_OUTPUT_INVALID_SCHEMA, TRANSCRIPT_TOO_LONG_FOR_MVP) qua `background_jobs.error_message`, client poll `GET /api/v1/background-jobs/:jobId`.

### 5.5 Polling contract

Không sửa gì ở endpoint background-jobs. Worker ghi `output_json = { minutesId, meetingId, status: 'draft' }` khi completed → DTO hiện có tự trả về trong `result`.

## 6. Authorization Plan

### 6.1 Permission Design

`meeting.minutes.ai_draft.create` — điều kiện cần (guard tầng framework).

### 6.2 Authorization Flow

1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.ai_draft.create')`.
3. Service check resource ownership: `meeting.hostId === authUser.userId` **HOẶC** user có role `SYSTEM_ADMIN` (resolve role qua pattern sẵn có của PermissionsGuard/AccountsModule — SYSTEM_ADMIN chỉ bypass ownership, KHÔNG bypass các validation khác, spec 2.3).

### 6.3 Error

Thiếu permission → 403 guard. Có permission nhưng không phải Host/System Admin → 403 `PERMISSION_DENIED` (service).

## 7. Business Logic Plan

### 7.1 API-side (MinutesAiDraftService.createAiDraftJob) — Transaction Boundary

```text
BEGIN TRANSACTION
  1. SELECT meeting FOR UPDATE — validate tồn tại + chưa xóa mềm       → 404 MEETING_NOT_FOUND
  2. Ownership: hostId === userId HOẶC SYSTEM_ADMIN                     → 403 PERMISSION_DENIED
  3. Đọc system_configs 'ai.minutes_summary' — thiếu key/enabled=false  → 403 AI_SUMMARY_DISABLED
  4. SELECT transcript — tồn tại + meetingId khớp                       → 404 TRANSCRIPT_NOT_FOUND
     status IN (draft, reviewed, approved)                              → 422 TRANSCRIPT_NOT_READY
     security_status NOT IN (restricted, blocked)                       → 403 TRANSCRIPT_RESTRICTED
  5. Dedup: SELECT background_jobs WHERE related_entity_type='meeting'
     AND related_entity_id=:meetingId AND job_type='ai_meeting_summary'
     AND status IN (queued, running, retrying)                          → 409 AI_JOB_ALREADY_RUNNING
  6. SELECT meeting_minutes WHERE meeting_id=:id AND deleted_at IS NULL:
     - tồn tại + forceRerun=false                                       → 409 MINUTES_ALREADY_EXISTS
     - tồn tại + forceRerun=true + (ai_summary_json IS NULL
       OR status != draft)                                              → 409 MINUTES_NOT_AI_DRAFT
  7. INSERT background_jobs (job_type=ai_meeting_summary,
     queue_name='minutes.generate_ai_draft', related_entity_*,
     requested_by, input_json={transcriptId, language, forceRerun},
     status=queued)
COMMIT
8. QueueService.addJob(AI_MINUTES_QUEUE_NAME, 'ai-minutes:generate',
   { backgroundJobId, meetingId, transcriptId, language, forceRerun, userId },
   { attempts: 2 })   // sau commit — nếu enqueue fail: mark job failed (compensating)
9. Return 202 { jobId, meetingId, status: 'queued' }
```

### 7.2 Worker-side (MinutesAiDraftProcessor.process)

```text
1. markRunning(backgroundJobId)
2. Đọc lại config ai.minutes_summary (fail-safe TOCTOU: enabled=false → failed AI_SUMMARY_DISABLED, non-retryable)
3. Load transcript, re-validate status + security_status (trạng thái có thể đổi giữa lúc queue)
4. Text nguồn = cleaned_text || raw_text. Token estimate = ceil(chars / 3)
   (heuristic tiếng Việt, tinh chỉnh sau benchmark) > maxInputTokens
   → failed TRANSCRIPT_TOO_LONG_FOR_MVP (non-retryable)
5. context = ContextRetrieverPort.retrieve(meetingId) — MVP luôn trả []
6. prompt = PromptBuilder.build({ transcriptText, language: 'vi-VN', context, promptVersion: 'mvp-v1' })
7. raw = LlmProviderPort.generate(prompt)  // timeout AI_SUMMARY_LLM_TIMEOUT_MS
   - lỗi mạng/timeout → throw (retryable — BullMQ retry theo attempts=2) → hết attempts: failed LLM_UNAVAILABLE
8. parsed = AiOutputValidator.validate(raw)
   - fail lần 1 → repairPrompt = build(output_lỗi + error_message + schema); raw2 = provider.generate(repairPrompt)
   - validate(raw2) fail → failed AI_OUTPUT_INVALID_SCHEMA (non-retryable, KHÔNG throw để tránh BullMQ retry)
9. dataSource.transaction(manager):
   a. SELECT meeting FOR UPDATE + SELECT minutes active (re-check race với UC-MKM-01 tạo tay):
      - chưa có minutes → INSERT (status=draft, visibility=private, version_no=1,
        prepared_by=userId, linked_transcript_id, minutes_content=summary,
        decisions_json, action_items_json, ai_summary_json{...phần còn lại + meta})
      - có minutes là AI-draft + forceRerun → UPDATE tại chỗ (version_no+1, prepared_by=userId, nội dung mới)
      - có minutes nhưng KHÔNG hợp lệ ghi đè (tạo tay chen giữa) → failed MINUTES_ALREADY_EXISTS (non-retryable)
   b. UPDATE background_jobs: status=completed, output_json={minutesId, meetingId, status:'draft'}, completed_at
   c. INSERT audit_logs (action='minutes.ai_draft.generated', actor=userId, meetingId/transcriptId/jobId) — qua manager, cùng transaction
10. Log duy nhất: jobId, meetingId, transcriptId, status, durationMs (FR-025)
```

### 7.3 Provider / Port design (NFR-012)

```text
src/modules/minutes/ai/
  llm-provider.port.ts        // interface LlmProviderPort { generate(prompt, opts): Promise<string> }
  mock-llm.provider.ts        // trả JSON mẫu hợp lệ (hoặc lỗi giả lập qua flag test)
  ollama-llm.provider.ts      // POST {baseUrl}/api/chat, model=config.modelName, format:'json',
                              // temperature=config.temperature, AbortSignal timeout
  context-retriever.port.ts   // interface + EmptyContextRetriever (MVP trả [])
  prompt-builder.ts           // template vi-VN theo Phụ lục A PDF, hằng PROMPT_VERSION='mvp-v1'
  ai-output-validator.ts      // validate tay theo schema spec 5.3 (required fields, enum confidence,
                              // reject field lạ) — pattern schemas.py của worker STT
```

Chọn provider lúc runtime theo `config_json.provider` (`mock` | `self_hosted_llm`) — factory trong module, không hard-code.

### 7.4 State Machine

`background_jobs`: `queued → running → completed | failed`, `running → retrying → running` (chỉ LLM_UNAVAILABLE). `meeting_minutes`: `(không tồn tại | draft AI cũ) → draft`. Không transition khác.

### 7.5 Key Business Rules

FR-001 (draft-only), FR-004/FR-010 (1 minutes active), FR-016/FR-020 (forceRerun chỉ đè AI-draft), FR-021 (prompt yêu cầu "Không xác định"), FR-025 (không log nội dung).

## 8. Validation Plan

### 8.1 Input Validation (DTO)

`CreateAiDraftJobDto`: `transcriptId` — `@IsUUID()`; `language` — `@IsOptional() @IsIn(['vi-VN'])`; `forceRerun` — `@IsOptional() @IsBoolean()`. `meetingId` — `ParseUUIDPipe`.

### 8.2 Business Validation

Thứ tự cố định theo mục 7.1 (đảm bảo error code deterministic cho test). Worker re-validate bước 2-4 và 9a (TOCTOU).

### 8.3 AI Output Validation

Validator tay: (1) JSON.parse; (2) required: summary/keyPoints/decisions/actionItems/risks/openQuestions/uncertainParts; (3) type từng field; (4) enum `confidence ∈ {high,medium,low}`; (5) actionItems đủ task/owner/deadline/confidence; (6) reject key ngoài schema. Unit test với fixtures sai (NFR-013a).

## 9. Error Handling Plan

### 9.1 Exception Mapping (API layer)

| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại/xóa mềm | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải Host/SysAdmin | `ForbiddenException` | `PERMISSION_DENIED` |
| Config thiếu/tắt | `ForbiddenException` | `AI_SUMMARY_DISABLED` |
| Transcript không tồn tại/sai meeting | `NotFoundException` | `TRANSCRIPT_NOT_FOUND` |
| Transcript chưa hoàn tất | `UnprocessableEntityException` | `TRANSCRIPT_NOT_READY` |
| Transcript restricted/blocked | `ForbiddenException` | `TRANSCRIPT_RESTRICTED` |
| Minutes đã tồn tại, forceRerun=false | `ConflictException` | `MINUTES_ALREADY_EXISTS` |
| forceRerun nhưng không phải AI-draft | `ConflictException` | `MINUTES_NOT_AI_DRAFT` |
| Job đang chạy | `ConflictException` | `AI_JOB_ALREADY_RUNNING` |

### 9.2 Worker Error Taxonomy

| Error code | Retryable? | Cơ chế |
| :--- | :--- | :--- |
| `LLM_UNAVAILABLE` (timeout/network/5xx) | Có (attempts=2) | throw → BullMQ retry; hết attempts → markFailed |
| `AI_OUTPUT_INVALID_SCHEMA` (sau 1 repair) | Không | markFailed + return (không throw) |
| `TRANSCRIPT_TOO_LONG_FOR_MVP` | Không | markFailed + return |
| `AI_SUMMARY_DISABLED`, `MINUTES_ALREADY_EXISTS` (TOCTOU) | Không | markFailed + return |

Error code ghi vào `background_jobs.error_message` dạng `CODE: mô tả ngắn` (không chứa transcript/prompt).

### 9.3 Transaction & Compensating

Transaction worker (7.2 bước 9) rollback trọn khi lỗi ghi DB → job sẽ retry hoặc failed, không có partial write (NFR-008/009). API-side: enqueue fail sau commit bước 7 → markFailed job ngay (compensating), trả 500.

## 10. Testing Strategy

### 10.1 Unit Tests

- `minutes-ai-draft.service.spec.ts`: happy path; từng nhánh lỗi 9.1 (9 case); SYSTEM_ADMIN bypass ownership nhưng không bypass flag/transcript checks.
- `ai-output-validator.spec.ts`: fixtures hợp lệ + ≥6 fixtures sai (thiếu field, sai type, sai enum confidence, actionItems thiếu owner, key lạ, không parse được) — NFR-013a.
- `prompt-builder.spec.ts`: chứa chỉ thị "Không xác định"/uncertainParts (FR-021), có PROMPT_VERSION, KHÔNG chứa placeholder rỗng.
- `minutes-ai-draft.processor.spec.ts` (mock provider + mock repo): happy (INSERT), forceRerun (UPDATE version_no+1, prepared_by đổi), too-long, invalid schema → repair thành công, invalid schema → repair fail → failed non-retry, LLM timeout → throw retryable, TOCTOU minutes tạo tay chen giữa; **logger spy** assert không log nội dung transcript/summary (AC-011).
- `mock-llm.provider.spec.ts` + `ollama-llm.provider.spec.ts` (mock fetch: 200/timeout/500/format json).

### 10.2 Integration Test

Theo pattern integration BullMQ+DB của transcription (nếu hạ tầng test live sẵn): tạo meeting+transcript thật → gọi API → chờ job (provider=mock) → assert `meeting_minutes` + `background_jobs.output_json.minutesId` + audit log (AC-001, AC-012).

### 10.3 Manual/Quickstart

Bước bật Ollama thật (pull model, set `provider=self_hosted_llm`, `enabled=true`) ghi trong quickstart.md — không thuộc automated suite.

## 11. Implementation Phases

> Nguyên tắc: mỗi phase kết thúc ở trạng thái demo được / dừng an toàn (timeline < 2 tuần).

### Phase 0 — Nền móng (0.5 ngày)
Migration `ai_summary_json` + entity update; enum `AI_MEETING_SUMMARY`; constant queue; 2 seeds; env mới vào `.env.example` + `env.validation.ts`; đăng ký queue trong `QueueModule`.

### Phase 1 — API layer (1-1.5 ngày)
DTO; `MinutesAiDraftService.createAiDraftJob` (7.1); controller + guards + Swagger; wire `minutes.module.ts`; unit tests service.

### Phase 2 — Worker + Mock (1.5-2 ngày) ← **điểm demo end-to-end đầu tiên**
`LlmProviderPort` + `MockLlmProvider` + `EmptyContextRetriever`; `PromptBuilder`; `AiOutputValidator` + fixtures tests; `MinutesAiDraftProcessor` (7.2, concurrency=1) + tests; audit log.

### Phase 3 — Ollama thật (1-1.5 ngày, song song cài Ollama)
`OllamaLlmProvider` (format json, timeout, AbortSignal); provider factory theo config; repair-prompt; test với mock fetch; thử nghiệm thật trên máy dev với transcript ngắn.

### Phase 4 — Hoàn thiện (0.5-1 ngày)
Integration test (nếu hạ tầng cho phép); quickstart.md; lint/build/test toàn bộ; rà lại FR-025 (log) + AC traceability.

## 12. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| Máy dev yếu, Qwen 7B chạy CPU chậm/hết RAM | Mock provider là đường demo chính (Phase 2 độc lập Ollama); model đổi được qua config (thử `qwen2.5:3b-instruct` nếu 7B quá nặng); timeout 5 phút + attempts=2 |
| Qwen trả JSON sai schema | Ollama `format:'json'` + prompt few-shot schema + repair 1 lần + validator chặn trước DB |
| Race: Host tạo minutes tay (UC-MKM-01) trong lúc job chạy | Worker re-check trong transaction với lock meeting FOR UPDATE (7.2-9a) → failed MINUTES_ALREADY_EXISTS, không đè |
| Token heuristic chars/3 lệch thực tế | Chỉ dùng làm guard thô; tinh chỉnh `maxInputTokens` sau benchmark Phase 3 (NEEDS CLARIFICATION duy nhất của spec) |
| Enqueue fail sau khi INSERT background_jobs | Compensating markFailed ngay tại API (9.3) |
| Seed system_configs bị đè config chỉnh tay | `ON CONFLICT DO NOTHING` |

## 13. Acceptance Criteria Traceability

Xem spec.md mục 7.8 — mọi AC đã map FR/ERR/NFR; test cases mục 10 phủ AC-001→AC-012.

## 14. Benchmark T018 (kết quả đo thật, 2026-07-07)

### 14.1 Môi trường đo
- Máy dev: 16GB RAM (free ~2.9GB tại thời điểm đo), CPU + Intel Iris Xe iGPU, **không có GPU rời**.
- Ollama v0.31.1, chạy inference trên CPU (không tăng tốc GPU với iGPU Intel).
- Transcript test: ~6 câu tiếng Việt (~600 ký tự) — 1 meeting ngắn theo scope local (audio ≤ 300s).

### 14.2 Model chốt: `qwen2.5:3b-instruct`
- 7B (`qwen2.5:7b-instruct` như plan gốc) **bị loại** vì free RAM (~2.9GB) không đủ nạp model 7B (~4.7GB) — sẽ swap/OOM. 3B (~1.9GB) chạy được ổn định.
- Đã cập nhật `system_configs.ai.minutes_summary.modelName` seed vẫn để `qwen2.5:7b-instruct` (giá trị production-target); khi demo trên máy yếu, đổi sang `qwen2.5:3b-instruct` qua config (không sửa code — NFR-012). **Không đổi seed default** để giữ nguyên ý định production; máy yếu override qua config.

### 14.3 Thời gian inference (đo thật)
| Lần chạy | Thời gian end-to-end (enqueue → completed) |
|---|---|
| Cold (model chưa nạp vào RAM) | ~104.5s |
| Warm (model đã nạp) | ~32.2s |

→ Timeout mặc định `AI_SUMMARY_LLM_TIMEOUT_MS=300000` (5 phút) có headroom đủ, kể cả cold start + repair 1 lần.

### 14.4 `maxInputTokens` — giữ 6000
Heuristic `chars/3` với transcript ~600 ký tự ≈ 200 token, xa ngưỡng 6000. Với audio local ≤ 300s (transcript thường vài nghìn ký tự), ngưỡng 6000 token an toàn cho single-pass. **Giữ nguyên `maxInputTokens=6000`**; điều chỉnh khi có transcript dài thật trong tương lai.

### 14.5 Phát hiện & xử lý (quan trọng cho quality)
- **Model 3B trả `confidence` là SỐ** (`1`, `0.95`) thay vì enum chuỗi `"high"|"medium"|"low"` ở lần chạy đầu → validator từ chối đúng → repair 1 lần vẫn fail → job `failed` với `AI_OUTPUT_INVALID_SCHEMA` (cơ chế an toàn hoạt động ĐÚNG: không ghi DB một phần).
- **Khắc phục (prompt engineering, đúng scope T018 "tinh chỉnh")**: tăng cường `prompt-builder.ts` — thêm khối "Quy tắc format BẮT BUỘC" (confidence LUÔN là chuỗi, không dùng số; actionItems đủ 4 khóa hoặc mảng rỗng; không thêm khóa ngoài schema) + 1 ví dụ output hợp lệ (few-shot). Sau khi sửa: **smoke test PASS**, model trả đúng enum, sinh minutes hoàn chỉnh (summary/decisions/actionItems/risks/keyPoints/openQuestions/uncertainParts đều hợp lệ).
- FR-021 xác nhận hoạt động thật: model điền `owner="Tuấn"` khi transcript có nêu tên, và `"Không xác định"` khi không rõ — không bịa.

## Artifacts Produced

`spec.md` (2026-07-07), `plan.md` (file này). Kế tiếp: `tasks.md` (chờ duyệt plan), `quickstart.md` (Phase 4). `research.md`/`data-model.md`/`contracts/` không tách file riêng — nội dung tương ứng đã gói trong mục 2 (research/codebase analysis), mục 4 (data model), mục 5 (contract) của plan này để gọn tài liệu cho timeline < 2 tuần.
