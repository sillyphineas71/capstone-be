# Task List: AI Meeting Minutes Draft (MKM-AI-01)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-07 | ✅ Hoàn thành Phase 4 (T019-T021) — **FEATURE MKM-AI-01 HOÀN TẤT 21/21 TASK**: quickstart.md (migration/seed/env/bật flag/curl demo/Ollama thật/troubleshooting); integration test `ai-minutes-draft-lifecycle.e2e-spec.ts` chạy THẬT qua BullMQ+Postgres+Redis với MockLlmProvider — **PASS 1/1** (gate RUN_INTEGRATION=1, mặc định skip), assert đầy đủ minutes draft + job completed output_json.minutesId + audit + ai_summary_json.meta; T021 build pass + 140 unit test module minutes pass + rà soát FR-025 (mọi logger call chỉ chứa id/status/errorCode, không có transcript/prompt/summary — đã verify bằng logger-spy AC-011). Đạt Definition of Done CLAUDE.md mục 31 | Checklist T019-T021 |
| 2026-07-07 | ✅ Hoàn thành Phase 3 (T016-T018): `OllamaLlmProvider` (POST /api/chat, format:json, AbortSignal timeout, map lỗi retryable) + factory switch mock/self_hosted_llm theo config + 5 unit test mock fetch. **T018 smoke test Ollama THẬT chạy trên máy dev** (cài Ollama v0.31.1 qua winget, pull qwen2.5:3b-instruct): lần đầu FAIL đúng cơ chế (model 3B trả confidence dạng SỐ → validator từ chối → repair fail → job failed AI_OUTPUT_INVALID_SCHEMA, không ghi DB); tăng cường prompt (rule confidence-là-chuỗi + few-shot) → **rerun PASS**: minutes hoàn chỉnh, confidence đúng enum, FR-021 xác nhận (owner="Tuấn"/"Không xác định" đúng, không bịa). Benchmark: cold ~104.5s, warm ~32.2s; chốt model 3B (7B thiếu RAM), giữ maxInputTokens=6000 → đóng NEEDS CLARIFICATION cuối của spec. 140 test module minutes pass, lint sạch, build OK. Đã cleanup dữ liệu test + tắt flag về false | Checklist T016-T018; plan.md mục 14; spec.md mục 1.5 |
| 2026-07-07 | ✅ Hoàn thành Phase 2 (T010-T015) — 🎯 CHECKPOINT DEMO MVP ĐẠT: ports (LlmProviderPort/ContextRetrieverPort) + MockLlmProvider + LlmProviderFactory + prompt builder vi-VN (mvp-v1, kèm repair-prompt) + validator tay theo schema 5.3 + BullMQ processor concurrency=1 (re-validate TOCTOU, token guard chars/3, repair 1 lần, transaction minutes+job+audit, retry taxonomy đúng plan 9.2). 25 test mới pass (tổng 135 test module minutes), lint 0 lỗi, build pass. **E2E mock smoke PASS trên hạ tầng thật** (app compiled + Redis + Postgres): enqueue → worker consume → background_jobs completed với output_json.minutesId → meeting_minutes draft đúng schema (version_no=1, ai_summary_json.meta đủ provider/model/promptVersion/jobId) → audit log `minutes.ai_draft.generated`; dữ liệu test đã cleanup, flag trả về false. Ghi chú vận hành: lệnh `kill` trong git-bash không giết được node trên Windows → app cũ chiếm port 3000 làm các boot sau EADDRINUSE, phải dọn qua PowerShell Stop-Process | Checklist T010-T015 |
| 2026-07-07 | ✅ Hoàn thành Phase 1 (T006-T009): DTO + `MinutesAiDraftService.createAiDraftJob` (transaction, lock meeting FOR UPDATE, đủ 9 nhánh lỗi theo thứ tự plan 7.1, compensating markFailed khi enqueue fail) + controller `POST /meetings/:meetingId/minutes/ai-draft-jobs` (202, guards, Swagger) + wire minutes.module. 19 unit test pass (happy path, 9 error branches, SYSTEM_ADMIN bypass-ownership-only, forceRerun matrix, enqueue compensating, FR-025 log spy). Lint 0 lỗi, build pass. Smoke test runtime: boot app thật (Docker redis + Postgres), endpoint trả 401 đúng khi thiếu token — route mapping xác nhận | Checklist T006-T009 |
| 2026-07-07 | ✅ Hoàn thành Phase 0 (T001-T005): migration + entity + enum + constants + queue thứ 9 + env vars + 2 seeds, build/lint pass, verify trên DB local (cột jsonb tồn tại, config đúng spec 5.2.2, permission gán 4/4 role). Ghi chú lệch phát hiện khi verify: (1) seeds phải đăng ký vào `scripts/run-seeds.ts` (registry, tasks chưa liệt kê file này); (2) DB local dùng role `EMPLOYEE` thay vì `INTERNAL_USER` → seed T004 liệt kê cả 2 alias, role không tồn tại bỏ qua an toàn (vấn đề pre-existing ảnh hưởng seed cũ, đã tách task riêng ngoài scope); (3) migration runner bị chặn bởi lỗi ledger pre-existing (migration cũ iot_devices 42P07) → cột được áp trực tiếp bằng SQL idempotent (IF NOT EXISTS), migration file vẫn đúng chuẩn để chạy khi ledger được sửa | Checklist T001-T005, Task T003/T004 |
| 2026-07-07 | Bổ sung mục "Tổng quan Phase" (mục tiêu, nhiệm vụ, ước lượng, checkpoint từng phase) ngay sau Checklist để nhìn toàn cảnh roadmap | Mục Tổng quan Phase |
| 2026-07-07 | Khởi tạo tasks cho feat-ai-meeting-minutes-draft theo plan.md (2026-07-07) — 21 task, 5 phase khớp plan Phase 0-4, điểm demo an toàn sau T015 (mock end-to-end) | Toàn bộ file |

**Input**: [spec.md](./spec.md) (2026-07-07), [plan.md](./plan.md) (2026-07-07)

## Checklist

- [x] T001 [US1] Migration `ai_summary_json` + entity update → `src/database/migrations/20260707000001-AddAiSummaryJsonToMeetingMinutes.ts`, `src/modules/minutes/entities/meeting-minutes.entity.ts`
- [x] T002 [P] [US1] Enum `AI_MEETING_SUMMARY` + constants file → `src/modules/administration/entities/background-job.entity.ts`, `src/modules/minutes/constants/ai-minutes-draft.constants.ts`
- [x] T003 [US1] Đăng ký queue mới + env vars → `src/modules/queue/queue.module.ts`, `src/modules/queue/queue.service.ts`, `.env.example`, `src/config/env.validation.ts`
- [x] T004 [P] [US1] Seed permission (kèm alias EMPLOYEE, đăng ký `scripts/run-seeds.ts`) → `src/database/seeds/20260707000001-SeedMeetingMinutesAiDraftPermission.ts`
- [x] T005 [P] [US1] Seed system_configs (đăng ký `scripts/run-seeds.ts`) → `src/database/seeds/20260707000002-SeedAiMinutesSummaryConfig.ts`
- [x] T006 [P] [US1] Request/Response DTO → `src/modules/minutes/dto/create-ai-draft-job.dto.ts`, `src/modules/minutes/dto/ai-draft-job-response.dto.ts`
- [x] T007 [US1] Service API-side → `src/modules/minutes/services/minutes-ai-draft.service.ts`
- [x] T008 [US1] Controller + wire module → `src/modules/minutes/controllers/minutes-ai-draft.controller.ts`, `src/modules/minutes/minutes.module.ts`
- [x] T009 [US1] Unit test service (19 tests pass) → `src/modules/minutes/services/minutes-ai-draft.service.spec.ts`
- [x] T010 [P] [US2] Provider/Retriever ports + Mock provider (kèm `llm-provider.factory.ts`) → `src/modules/minutes/ai/llm-provider.port.ts`, `context-retriever.port.ts`, `mock-llm.provider.ts`
- [x] T011 [P] [US2] Prompt builder → `src/modules/minutes/ai/prompt-builder.ts`
- [x] T012 [P] [US2] Output validator → `src/modules/minutes/ai/ai-output-validator.ts`
- [x] T013 [US2] Unit tests validator (9) + prompt builder (5) → `src/modules/minutes/ai/ai-output-validator.spec.ts`, `prompt-builder.spec.ts`
- [x] T014 [US2] Worker processor + provider factory → `src/modules/minutes/processors/minutes-ai-draft.processor.ts`, cập nhật `minutes.module.ts`
- [x] T015 [US2] Unit test processor 11 case kèm logger spy → `src/modules/minutes/processors/minutes-ai-draft.processor.spec.ts` — ✅ E2E mock smoke PASS trên hạ tầng thật (checkpoint Phase 2)
- [x] T016 [US3] Ollama provider + factory switch → `src/modules/minutes/ai/ollama-llm.provider.ts`
- [x] T017 [US3] Unit test Ollama provider (5 test, mock fetch) → `src/modules/minutes/ai/ollama-llm.provider.spec.ts`
- [x] T018 [US3] Smoke test Ollama thật PASS + benchmark → ghi plan.md mục 14; chốt model `qwen2.5:3b-instruct`, tăng cường prompt vì 3B trả confidence dạng số
- [x] T019 [P] [US4] quickstart.md → `spec/features/minutes/feat-ai-meeting-minutes-draft/quickstart.md`
- [x] T020 [US4] Integration test BullMQ+DB (PASS 1/1, gate RUN_INTEGRATION=1) → `test/ai-minutes-draft-lifecycle.e2e-spec.ts`
- [x] T021 [US4] Build pass + 140 unit test module minutes pass + rà soát FR-025 (log chỉ id/status/errorCode) + cập nhật docs

> **Điểm dừng an toàn**: sau T015 — demo end-to-end được với MockLlmProvider, chưa cần Ollama (khớp plan Phase 2).

---

## Tổng quan Phase

> Roadmap 5 phase để hoàn thành feature, tổng ~5-6.5 ngày công (buffer trong timeline < 2 tuần). Chi tiết từng task ở các mục Phase bên dưới.

### Phase 0 — Nền móng (T001-T005, ~0.5 ngày)

**Mục tiêu**: Schema, cấu hình và hạ tầng queue sẵn sàng — chưa có business logic.

| Nhiệm vụ | Task |
|---|---|
| Migration thêm cột `ai_summary_json` vào `meeting_minutes` + cập nhật entity | T001 |
| Thêm `AI_MEETING_SUMMARY` vào enum `BackgroundJobType` + file constants (queue name, job name, config key, prompt version, error codes) | T002 |
| Đăng ký queue `minutes.generate_ai_draft` trong `QueueModule` + 3 env vars mới | T003 |
| Seed permission `meeting.minutes.ai_draft.create` cho 4 role | T004 |
| Seed `system_configs` key `ai.minutes_summary` (enabled=false, provider=mock) | T005 |

**Checkpoint**: App boot bình thường, migration up/down chạy được, seeds idempotent. T001/T002/T004/T005 song song được; T003 cần constants của T002.

### Phase 1 — API Layer (T006-T009, ~1-1.5 ngày)

**Mục tiêu**: Endpoint tạo job hoạt động đầy đủ validation/authorization — job vào queue nhưng chưa có worker xử lý.

| Nhiệm vụ | Task |
|---|---|
| DTO request (`transcriptId`, `language`, `forceRerun`) + DTO response (202) | T006 |
| Service `createAiDraftJob`: transaction, 9 nhánh lỗi theo thứ tự cố định, dedup, enqueue attempts=2, compensating khi enqueue fail | T007 |
| Controller `POST /meetings/:meetingId/minutes/ai-draft-jobs` + guards + Swagger + wire module | T008 |
| Unit test service ≥12 case (happy + 9 nhánh lỗi + SYSTEM_ADMIN bypass + compensating) | T009 |

**Checkpoint**: Gọi API trả 202 + jobId; 401/403/404/409/422 đúng spec mục 6; `background_jobs` có record queued.

### Phase 2 — Worker + Mock Provider (T010-T015, ~1.5-2 ngày) 🎯 ĐIỂM DEMO MVP

**Mục tiêu**: Luồng async end-to-end hoàn chỉnh với MockLlmProvider — demo được KHÔNG cần Ollama.

| Nhiệm vụ | Task |
|---|---|
| `LlmProviderPort` + `ContextRetrieverPort` (trả rỗng, chuẩn bị RAG) + `MockLlmProvider` | T010 |
| Prompt builder vi-VN (chỉ thị "Không xác định", uncertainParts, schema literal) + repair-prompt | T011 |
| Output validator viết tay theo schema spec 5.3 | T012 |
| Unit tests validator (≥6 fixtures sai) + prompt builder | T013 |
| Processor BullMQ (concurrency=1): re-validate, token guard, gọi provider, repair 1 lần, transaction ghi minutes + job + audit | T014 |
| Unit test processor (INSERT/forceRerun UPDATE/too-long/invalid schema/timeout/TOCTOU + logger spy không log nội dung nhạy cảm) | T015 |

**Checkpoint**: POST → poll `GET /background-jobs/:jobId` → completed với `output_json.minutesId` → GET minutes thấy draft đúng schema. **Dừng ở đây vẫn có sản phẩm demo nếu deadline ép.**

### Phase 3 — Ollama thật (T016-T018, ~1-1.5 ngày)

**Mục tiêu**: Thay mock bằng LLM thật (Qwen2.5 qua Ollama) — chỉ đổi config, không đổi business logic.

| Nhiệm vụ | Task |
|---|---|
| `OllamaLlmProvider` (`/api/chat`, `format: json`, AbortSignal timeout) + factory switch theo `config_json.provider` | T016 |
| Unit test Ollama provider với mock fetch (200/timeout/500/body đúng) | T017 |
| Smoke test Ollama thật + benchmark RAM/thời gian → chốt model size (7B/3B) và `maxInputTokens` (đóng NEEDS CLARIFICATION cuối của spec) | T018 |

**Checkpoint**: 1 job completed thật end-to-end với Qwen2.5; số đo benchmark ghi vào plan.md.
**Lưu ý**: cài Ollama + pull model chạy nền NGAY TỪ NGÀY ĐẦU (download lâu), không chặn Phase 0-2.

### Phase 4 — Hoàn thiện (T019-T021, ~0.5-1 ngày)

**Mục tiêu**: Đạt Definition of Done (CLAUDE.md mục 31), người khác trong team tự chạy được.

| Nhiệm vụ | Task |
|---|---|
| quickstart.md (migration, seeds, env, Ollama optional, curl demo, troubleshooting) | T019 |
| Integration test BullMQ+DB với mock provider (optional theo hạ tầng test live — tiền lệ UC-MKM-01) | T020 |
| Lint/build/test toàn repo + rà FR-025 (grep log) + tick checklist + changelog | T021 |

**Checkpoint**: 3 lệnh lint/build/test pass (fail pre-existing được ghi chú); tài liệu đủ để bàn giao.

---

## Phase 0: Nền móng (T001-T005)

### Task T001 [US1] — Migration `ai_summary_json` + cập nhật entity
**File**: `src/database/migrations/20260707000001-AddAiSummaryJsonToMeetingMinutes.ts`, `src/modules/minutes/entities/meeting-minutes.entity.ts`
**Action**:
- Migration: `ALTER TABLE meeting_minutes ADD COLUMN ai_summary_json jsonb NULL` (down: DROP COLUMN). Theo naming convention migration hiện có.
- Entity: thêm
  ```ts
  @Column({ name: 'ai_summary_json', type: 'jsonb', nullable: true })
  aiSummaryJson: Record<string, unknown> | null;
  ```
**Outcome**: Cột mới duy nhất được phê duyệt ở spec 5.2 tồn tại trong schema + entity. NULL = minutes soạn tay, khác NULL = nguồn gốc AI.
**Verification**: `npm run build` pass; chạy migration trên DB local thành công (up + down).

### Task T002 [P] [US1] — Enum job type + constants
**File**: `src/modules/administration/entities/background-job.entity.ts`, `src/modules/minutes/constants/ai-minutes-draft.constants.ts`
**Action**:
- Thêm `AI_MEETING_SUMMARY = 'ai_meeting_summary'` vào enum `BackgroundJobType` (cột DB là varchar(80) — không cần migration, xem spec 5.2.1).
- Tạo constants file:
  ```ts
  export const AI_MINUTES_QUEUE_NAME = 'minutes.generate_ai_draft';
  export const AI_MINUTES_JOB_NAME = 'ai-minutes:generate';
  export const AI_MINUTES_CONFIG_KEY = 'ai.minutes_summary';
  export const AI_MINUTES_PROMPT_VERSION = 'mvp-v1';
  export const AI_MINUTES_AUDIT_ACTION = 'minutes.ai_draft.generated';
  // Error codes: AI_SUMMARY_DISABLED, TRANSCRIPT_NOT_READY, TRANSCRIPT_RESTRICTED,
  // MINUTES_ALREADY_EXISTS, MINUTES_NOT_AI_DRAFT, AI_JOB_ALREADY_RUNNING,
  // LLM_UNAVAILABLE, AI_OUTPUT_INVALID_SCHEMA, TRANSCRIPT_TOO_LONG_FOR_MVP
  ```
**Outcome**: Không magic string rải rác; queue name là single source of truth cho cả QueueModule lẫn `@Processor`.
**Verification**: Compile pass; grep không còn literal `'ai_meeting_summary'` ngoài enum/constants.

### Task T003 [US1] — Đăng ký queue + env vars
**File**: `src/modules/queue/queue.module.ts`, `.env.example`, `src/config/env.validation.ts`
**Action**:
- Thêm entry thứ 9 vào `BullModule.registerQueueAsync`: token `QUEUE_MINUTES_AI_DRAFT_NAME`, `name: cs.get('QUEUE_MINUTES_AI_DRAFT', 'minutes.generate_ai_draft')`; bổ sung queue vào `queueMap` của `QueueService` (theo cách 8 queue hiện có).
- `.env.example` thêm: `QUEUE_MINUTES_AI_DRAFT=minutes.generate_ai_draft`, `AI_SUMMARY_LLM_BASE_URL=http://localhost:11434`, `AI_SUMMARY_LLM_TIMEOUT_MS=300000` (kèm comment tiếng Việt ngắn).
- `env.validation.ts`: khai báo 3 biến optional với default.
**Outcome**: `QueueService.addJob(AI_MINUTES_QUEUE_NAME, ...)` hoạt động; worker/provider đọc config qua ConfigService.
**Verification**: App boot không lỗi; `QueueService` log available queues có `minutes.generate_ai_draft`.

### Task T004 [P] [US1] — Seed permission `meeting.minutes.ai_draft.create`
**File**: `src/database/seeds/20260707000001-SeedMeetingMinutesAiDraftPermission.ts`
**Action**: Copy pattern `20260702000001-SeedMeetingMinutesCreatePermission.ts`: permission_code=`meeting.minutes.ai_draft.create`, permission_name=`Tao bien ban hop nhap bang AI`, module_code=`minutes`, action_code=`minutes.ai_draft.create`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` (role codes đã xác minh khớp seed thật — spec 2.2). `ON CONFLICT DO NOTHING`.
**Outcome**: Permission + role_permissions sẵn sàng cho `PermissionsGuard`.
**Verification**: Chạy seed trên DB local → SELECT thấy permission gán đủ 4 role.

### Task T005 [P] [US1] — Seed system_configs `ai.minutes_summary`
**File**: `src/database/seeds/20260707000002-SeedAiMinutesSummaryConfig.ts`
**Action**: Theo pattern `20260616000002-SeedCheckinAlertConfig.ts`, INSERT `system_configs` với config_key=`ai.minutes_summary`, config_json đúng spec 5.2.2 (`enabled=false`, `provider=mock`, `modelName=qwen2.5:7b-instruct`, `allowExternalProvider=false`, `requireHumanReview=true`, `maxInputTokens=6000`, `temperature=0.2`, `retentionDays=90`, `logRawTranscript=false`). `ON CONFLICT (config_key) DO NOTHING` để không đè config chỉnh tay (plan mục 12).
**Outcome**: Feature flag mặc định TẮT (fail-safe FR-014); bật thủ công khi demo.
**Verification**: Chạy seed → SELECT config_json đúng; chạy lại lần 2 không đè.

---

## Phase 1: API Layer (T006-T009)

### Task T006 [P] [US1] — Request/Response DTO
**File**: `src/modules/minutes/dto/create-ai-draft-job.dto.ts`, `src/modules/minutes/dto/ai-draft-job-response.dto.ts`
**Action**:
- `CreateAiDraftJobDto`: `transcriptId` (`@IsUUID()`), `language?` (`@IsOptional() @IsIn(['vi-VN'])`), `forceRerun?` (`@IsOptional() @IsBoolean()`).
- `AiDraftJobResponseDto`: `{ jobId, meetingId, status }` + `@ApiProperty` (ENG-02/Swagger).
**Outcome**: Validate đúng spec 5.4/5.5; reject field lạ qua ValidationPipe whitelist.
**Verification**: Compile pass; DTO test gián tiếp qua T009.

### Task T007 [US1] — `MinutesAiDraftService.createAiDraftJob`
**File**: `src/modules/minutes/services/minutes-ai-draft.service.ts`
**Action**: Implement đúng pseudo-code plan 7.1 — transaction `dataSource.transaction`, thứ tự validation CỐ ĐỊNH:
1. Lock meeting `FOR UPDATE` (`lock: { mode: 'pessimistic_write' }`), validate tồn tại/xóa mềm → `MEETING_NOT_FOUND`.
2. Ownership: `meeting.hostId === userId` HOẶC user có role `SYSTEM_ADMIN` (resolve role theo pattern sẵn có; SYSTEM_ADMIN chỉ bypass ownership) → `PERMISSION_DENIED`.
3. Đọc `system_configs` key `ai.minutes_summary` — thiếu key hoặc `enabled=false` → `AI_SUMMARY_DISABLED`.
4. Transcript: tồn tại + đúng meeting → `TRANSCRIPT_NOT_FOUND`; `status IN (draft, reviewed, approved)` → `TRANSCRIPT_NOT_READY`; `security_status NOT IN (restricted, blocked)` → `TRANSCRIPT_RESTRICTED`.
5. Dedup theo `related_entity_type='meeting'` + `related_entity_id` + `job_type` + `status IN (queued, running, retrying)` → `AI_JOB_ALREADY_RUNNING`.
6. Minutes active (`deletedAt IsNull`): tồn tại + !forceRerun → `MINUTES_ALREADY_EXISTS`; forceRerun + (aiSummaryJson NULL hoặc status≠draft) → `MINUTES_NOT_AI_DRAFT`.
7. INSERT `background_jobs` (status=queued, input_json={transcriptId, language, forceRerun}).
Sau COMMIT: `queueService.addJob(AI_MINUTES_QUEUE_NAME, AI_MINUTES_JOB_NAME, payload, { attempts: 2 })`; nếu enqueue throw → markFailed job (compensating, plan 9.3) rồi rethrow 500.
**Outcome**: Toàn bộ nhánh lỗi API (spec 6.1-6.4) throw đúng exception + code; job vào queue với attempts=2.
**Verification**: T009 pass đủ nhánh.

### Task T008 [US1] — Controller + wire module
**File**: `src/modules/minutes/controllers/minutes-ai-draft.controller.ts`, `src/modules/minutes/minutes.module.ts`
**Action**:
- Controller: `POST 'meetings/:meetingId/minutes/ai-draft-jobs'`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.minutes.ai_draft.create')`, `@HttpCode(202)`, `ParseUUIDPipe` cho meetingId, `@CurrentUser()`, Swagger annotations. Response `{ success: true, message: 'AI draft job queued', data }`.
- Module: đăng ký controller/service mới; import `AuthModule` (JwtAuthGuard), `AdministrationModule` hoặc entity cần thiết (`BackgroundJobEntity`, `SystemConfigEntity`, `AuditLogEntity` — theo cách transcription/minutes hiện làm), `TranscriptEntity` qua `TranscriptionModule` export sẵn.
**Outcome**: Endpoint sống, guard đúng, 202 + jobId.
**Verification**: `npm run build`; gọi thử qua REST client (401 khi thiếu token, 403 khi thiếu permission).

### Task T009 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes-ai-draft.service.spec.ts`
**Action**: Mock DataSource/EntityManager/QueueService/ConfigService. Cases (≥12): happy path 202; 9 nhánh lỗi plan 9.1 (MEETING_NOT_FOUND, PERMISSION_DENIED, AI_SUMMARY_DISABLED — cả thiếu key lẫn enabled=false, TRANSCRIPT_NOT_FOUND, TRANSCRIPT_NOT_READY, TRANSCRIPT_RESTRICTED, MINUTES_ALREADY_EXISTS, MINUTES_NOT_AI_DRAFT, AI_JOB_ALREADY_RUNNING); SYSTEM_ADMIN bypass ownership NHƯNG vẫn bị chặn bởi flag/transcript; enqueue fail → compensating markFailed.
**Outcome**: Phủ AC-002→AC-006, AC-008 + FR-007/010/011/012/014/017/020/022-024.
**Verification**: `npm test -- minutes-ai-draft.service` pass toàn bộ.

---

## Phase 2: Worker + Mock Provider (T010-T015)

### Task T010 [P] [US2] — Ports + MockLlmProvider + EmptyContextRetriever
**File**: `src/modules/minutes/ai/llm-provider.port.ts`, `src/modules/minutes/ai/context-retriever.port.ts`, `src/modules/minutes/ai/mock-llm.provider.ts`
**Action**:
- `LlmProviderPort`: `generate(prompt: string, opts: { timeoutMs: number; temperature: number; modelName: string }): Promise<string>` + injection token.
- `ContextRetrieverPort`: `retrieve(meetingId: string): Promise<string[]>` + `EmptyContextRetriever` luôn trả `[]` (chuẩn bị RAG phase sau — NFR-012, OOS-001 vẫn giữ).
- `MockLlmProvider`: trả JSON hợp lệ theo schema spec 5.3 (nội dung mẫu tiếng Việt); hỗ trợ chế độ lỗi giả lập qua constructor/flag để test (timeout, JSON sai).
**Outcome**: Business logic không phụ thuộc LLM thật; đường demo chính khi chưa có Ollama.
**Verification**: Compile; dùng trong T015.

### Task T011 [P] [US2] — Prompt builder
**File**: `src/modules/minutes/ai/prompt-builder.ts`
**Action**: Template vi-VN theo Phụ lục A của tài liệu định hướng: chỉ dùng thông tin trong transcript; không bịa tên/deadline/quyết định; thiếu thông tin → `"Không xác định"`; phần nghi lỗi STT → `uncertainParts`; trả JSON đúng schema (embed schema literal), không markdown. Nhận `{ transcriptText, context: string[], promptVersion }` — context rỗng MVP. Export dùng `AI_MINUTES_PROMPT_VERSION`. Kèm hàm build repair-prompt: `{ output_lỗi, error_message, schema }` (plan FR-019).
**Outcome**: FR-021 được thể hiện trong prompt; promptVersion trace được (DM-04).
**Verification**: T013 snapshot/content assertions.

### Task T012 [P] [US2] — Output validator
**File**: `src/modules/minutes/ai/ai-output-validator.ts`
**Action**: Validator tay theo plan 8.3 (pattern `schemas.py` worker STT): parse JSON → required fields → type check → enum `confidence` → actionItems đủ `task/owner/deadline/confidence` → reject key ngoài schema. Trả `{ ok: true, data } | { ok: false, error: string }` (error message dùng cho repair-prompt).
**Outcome**: FR-006 enforce trước khi ghi DB.
**Verification**: T013 fixtures.

### Task T013 [US2] — Unit tests validator + prompt builder
**File**: `src/modules/minutes/ai/ai-output-validator.spec.ts`, `src/modules/minutes/ai/prompt-builder.spec.ts`
**Action**:
- Validator: 1 fixture hợp lệ + ≥6 fixtures sai (không parse được; thiếu `summary`; `confidence` ngoài enum; actionItems thiếu `owner`; sai type `keyPoints`; key lạ ngoài schema) — NFR-013a, giải đáp clarify AC-01.
- Prompt builder: chứa chỉ thị "Không xác định", "uncertainParts", schema literal, PROMPT_VERSION; repair-prompt chứa error message truyền vào.
**Outcome**: Schema validation được test TRỰC TIẾP, không chỉ qua mock provider.
**Verification**: `npm test -- minutes/ai` pass.

### Task T014 [US2] — Worker processor + provider factory
**File**: `src/modules/minutes/processors/minutes-ai-draft.processor.ts`, cập nhật `src/modules/minutes/minutes.module.ts`
**Action**: `@Processor(AI_MINUTES_QUEUE_NAME, { concurrency: 1 })` extends `WorkerHost`, implement đúng plan 7.2:
1. markRunning → 2. re-check config (fail-safe) → 3. re-validate transcript → 4. token guard `ceil(chars/3) > maxInputTokens` → `TRANSCRIPT_TOO_LONG_FOR_MVP` → 5. context (Empty) → 6. build prompt → 7. provider.generate (timeout env; lỗi mạng/timeout → throw để BullMQ retry; hết attempts BullMQ gọi failed handler → markFailed `LLM_UNAVAILABLE`) → 8. validate; fail → repair 1 lần; vẫn fail → markFailed `AI_OUTPUT_INVALID_SCHEMA` + return (KHÔNG throw) → 9. transaction: lock meeting FOR UPDATE, re-check minutes active (TOCTOU → markFailed `MINUTES_ALREADY_EXISTS`), INSERT hoặc UPDATE (forceRerun: version_no+1, prepared_by=userId trigger), UPDATE background_jobs completed + output_json `{minutesId, meetingId, status:'draft'}`, INSERT audit_logs qua manager (action=`minutes.ai_draft.generated`).
Provider factory trong module: chọn Mock/Ollama theo `config_json.provider` (T016 bổ sung nhánh Ollama; tại T014 factory chỉ có mock + throw nếu provider lạ).
Log CHỈ jobId/meetingId/transcriptId/status/durationMs/errorCode (FR-025).
**Outcome**: Luồng async end-to-end hoàn chỉnh với mock; phân loại retryable/non-retryable đúng plan 9.2.
**Verification**: T015 pass; chạy tay: bật flag + provider=mock → POST → poll background-jobs → thấy minutesId → GET minutes thấy draft.

### Task T015 [US2] — Unit test processor
**File**: `src/modules/minutes/processors/minutes-ai-draft.processor.spec.ts`
**Action**: Mock provider/repos/manager. Cases: happy INSERT (version_no=1, ai_summary_json.meta đủ provider/modelName/promptVersion/generatedByJobId/generatedAt); forceRerun UPDATE (version_no 1→2, prepared_by đổi — AC-007); config tắt giữa chừng → failed AI_SUMMARY_DISABLED; too-long → failed TRANSCRIPT_TOO_LONG_FOR_MVP non-retry; invalid schema → repair thành công → completed; invalid schema ×2 → failed AI_OUTPUT_INVALID_SCHEMA non-retry (assert KHÔNG throw); LLM timeout → assert throw (retryable); TOCTOU minutes tạo tay → failed MINUTES_ALREADY_EXISTS; **logger spy**: mọi case assert log không chứa transcript text/summary/prompt (AC-011, FR-025).
**Outcome**: Phủ AC-001 (phần worker), AC-007, AC-009, AC-010, AC-011.
**Verification**: `npm test -- minutes-ai-draft.processor` pass.

---

## Phase 3: Ollama Provider (T016-T018)

### Task T016 [US3] — `OllamaLlmProvider` + factory switch
**File**: `src/modules/minutes/ai/ollama-llm.provider.ts`, cập nhật factory trong `minutes.module.ts`
**Action**: `POST {AI_SUMMARY_LLM_BASE_URL}/api/chat` body `{ model: opts.modelName, messages: [{role:'user', content: prompt}], format: 'json', stream: false, options: { temperature } }`; `AbortSignal.timeout(opts.timeoutMs)`; map lỗi network/timeout/HTTP≠2xx → throw `LLM_UNAVAILABLE`-classified error; trả `message.content`. Factory: `provider === 'self_hosted_llm'` → Ollama, `'mock'` → Mock.
**Outcome**: Đường chạy LLM thật, đổi qua config không sửa code (NFR-012); không outbound internet (base URL nội bộ).
**Verification**: T017; smoke T018.

### Task T017 [US3] — Unit test Ollama provider
**File**: `src/modules/minutes/ai/ollama-llm.provider.spec.ts`
**Action**: Mock `fetch`: 200 hợp lệ (parse message.content); timeout (AbortError) → throw đúng loại; HTTP 500 → throw; body request đúng (`format:'json'`, model, temperature).
**Outcome**: Provider hành xử đúng contract mà không cần Ollama thật.
**Verification**: Test pass.

### Task T018 [US3] — Smoke test Ollama thật + benchmark (manual)
**File**: kết quả ghi vào `plan.md` mục 12 (changelog mới) và `quickstart.md` (T019)
**Action**: Cài Ollama local, `ollama pull qwen2.5:7b-instruct`; set config `provider=self_hosted_llm`, `enabled=true`; chạy flow thật với transcript ngắn (≤300s audio); đo thời gian inference + RAM; nếu 7B quá nặng thử `qwen2.5:3b-instruct`; tinh chỉnh `maxInputTokens`/heuristic chars/3 theo số đo (đóng NEEDS CLARIFICATION cuối của spec 1.5).
**Outcome**: Số liệu thật cho quyết định model size + token threshold; demo được với LLM thật.
**Verification**: 1 job completed thật end-to-end với Ollama; số đo ghi lại kèm changelog.

---

## Phase 4: Hoàn thiện (T019-T021)

### Task T019 [P] [US4] — quickstart.md
**File**: `spec/features/minutes/feat-ai-meeting-minutes-draft/quickstart.md`
**Action**: Hướng dẫn: chạy migration; chạy 2 seed thủ công (pattern các seed hiện có); env vars mới; cài Ollama + pull model (optional — mock là mặc định); bật flag `enabled=true` + đổi provider; curl mẫu POST ai-draft-jobs → poll background-jobs → GET minutes; troubleshooting (AI_SUMMARY_DISABLED, LLM_UNAVAILABLE...).
**Outcome**: Người khác trong team tự chạy được demo không cần hỏi.
**Verification**: Làm theo từng bước trên máy sạch config → demo chạy.

### Task T020 [US4] — Integration test (optional theo hạ tầng)
**File**: `test/` theo pattern integration BullMQ+DB của transcription (nếu hạ tầng Postgres+Redis live test đã sẵn)
**Action**: Tạo meeting + transcript thật → POST endpoint → chờ job (provider=mock) → assert `meeting_minutes` (status=draft, version_no=1, ai_summary_json.meta), `background_jobs` (completed, output_json.minutesId), audit log tồn tại (AC-001, AC-012).
**Outcome**: Phủ integration NFR-013b. Nếu hạ tầng chưa sẵn: ghi chú defer, KHÔNG chặn feature (theo tiền lệ UC-MKM-01 mục 10.2).
**Verification**: Test pass trên môi trường live-test hoặc ghi chú defer rõ ràng.

### Task T021 [US4] — Lint/build/test toàn repo + rà soát cuối
**Action**: `npm run lint`, `npm run build`, `npm test`; rà FR-025 lần cuối (grep log statements trong code mới — không có transcript/prompt/summary); đối chiếu AC coverage bảng dưới; tick checklist tasks.md + ghi changelog (RULE TỐI THƯỢNG 2); ghi chú test fail pre-existing không liên quan nếu có (theo tiền lệ T009 của UC-MKM-01).
**Outcome**: Feature đạt Definition of Done (CLAUDE.md mục 31).
**Verification**: 3 lệnh pass (hoặc fail được ghi chú rõ là pre-existing).

---

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001 (draft-only) | T007, T014 |
| FR-002 (self-hosted only) | T016 (base URL nội bộ), T005 (allowExternalProvider=false) |
| FR-003 (mapping cột) | T001, T014, T015 |
| FR-004, FR-010 (1 minutes active) | T007, T009, T014 (TOCTOU), T015 |
| FR-005 (prepared_by, linked_transcript_id) | T014, T015 |
| FR-006 (schema validation) | T012, T013, T014 |
| FR-007 (endpoint + job record) | T002, T003, T006, T007, T008 |
| FR-008 (transaction + output_json) | T014, T015, T020 |
| FR-009 (audit) | T014, T015, T020 |
| FR-011 (dedup) | T007, T009 |
| FR-012 (transcript status) | T007, T009, T014 |
| FR-013 (không đổi luồng publish) | — (không sửa code publish; guard bằng OOS-004) |
| FR-014 (feature flag fail-safe) | T005, T007, T009, T014 |
| FR-015 (mock provider) | T010, T014 |
| FR-016 (forceRerun UPDATE) | T007, T014, T015 |
| FR-017 (security_status) | T007, T009, T014 |
| FR-018 (retry policy) | T007 (attempts=2), T014, T015 |
| FR-019 (repair 1 lần) | T011, T014, T015 |
| FR-020 (bảo vệ minutes tay) | T007, T009 |
| FR-021 (prompt "Không xác định") | T011, T013 |
| FR-022→024 (authz) | T008 (guards), T007, T009 |
| FR-025 (không log nhạy cảm) | T014, T015 (logger spy), T021 (rà soát) |
| FR-026 (job status + error_message) | T007, T014, T015 |

### NFR Coverage
| NFR ID | Task(s) |
| :--- | :--- |
| NFR-001 (202 < 2s) | T007 (chỉ validate + insert + enqueue) |
| NFR-002 (concurrency=1) | T014 |
| NFR-003 (timeout env) | T003, T016 |
| NFR-004→007 (security) | T004, T005, T008, T016 |
| NFR-008/009 (transaction) | T007, T014, T015 |
| NFR-010/011 (observability/audit) | T014, T015 |
| NFR-012 (provider port) | T010, T016 |
| NFR-013 (test layers) | T009, T013, T015, T017, T020 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001 | T009 (API), T015 (worker), T020 (integration) |
| AC-002 | T006, T009 |
| AC-003 | T008, T009 |
| AC-004, AC-005, AC-006 | T009 |
| AC-007 | T015 |
| AC-008 | T009 |
| AC-009, AC-010 | T015 |
| AC-011 | T015 (logger spy), T021 |
| AC-012 | T015, T020 |

### Error Code Coverage
| Error Code | HTTP/Job | Task(s) |
| :--- | :--- | :--- |
| VALIDATION_ERROR (ERR-001/002) | 400 | T006, T009 |
| PERMISSION_DENIED | 403 | T007, T008, T009 |
| AI_SUMMARY_DISABLED | 403 / job failed | T007, T009, T014, T015 |
| TRANSCRIPT_RESTRICTED | 403 | T007, T009 |
| MEETING_NOT_FOUND / TRANSCRIPT_NOT_FOUND | 404 | T007, T009 |
| TRANSCRIPT_NOT_READY | 422 | T007, T009 |
| MINUTES_ALREADY_EXISTS | 409 / job failed (TOCTOU) | T007, T009, T014, T015 |
| MINUTES_NOT_AI_DRAFT | 409 | T007, T009 |
| AI_JOB_ALREADY_RUNNING | 409 | T007, T009 |
| LLM_UNAVAILABLE | job failed/retrying | T014, T015, T016, T017 |
| AI_OUTPUT_INVALID_SCHEMA | job failed | T012, T014, T015 |
| TRANSCRIPT_TOO_LONG_FOR_MVP | job failed | T014, T015 |

## Dependencies Graph

```text
T001 ─┬────────────────────────────┐
T002 ─┤ (P với T001)               │
T003 ─┤ (cần T002 constants)       ├─> T007 ─> T008 ─> T009
T004 ─┤ (P)                        │      │
T005 ─┤ (P)                        │      │
T006 ─┘ (P)                        │      │
                                   │      v
T010 ─┬─(P, sau T002)              └─> T014 ─> T015   ← ĐIỂM DEMO MOCK
T011 ─┤ (P)                            ^
T012 ─┘ (P) ─> T013 ──────────────────┘
T016 ─> T017 ─> T018                    (sau T014; cài Ollama song song từ đầu)
T019 (P, sau T015) ─┐
T020 (sau T015)     ├─> T021
T018 ───────────────┘
```

## Implementation Order

| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002, T004, T005 | 0 | Migration + enum/constants + 2 seeds (song song được) |
| 2 | T003 | 0 | Queue + env (cần constants T002) |
| 3 | T006 | 1 | DTOs |
| 4 | T007 | 1 | Service API-side |
| 5 | T008 | 1 | Controller + wiring |
| 6 | T009 | 1 | Unit test service |
| 7 | T010, T011, T012 | 2 | Ports/Mock + prompt + validator (song song được) |
| 8 | T013 | 2 | Tests validator + prompt |
| 9 | T014 | 2 | Processor + factory |
| 10 | T015 | 2 | Test processor — **điểm demo mock end-to-end** |
| 11 | T016, T017 | 3 | Ollama provider + test |
| 12 | T018 | 3 | Smoke Ollama thật + benchmark |
| 13 | T019, T020 | 4 | quickstart + integration test |
| 14 | T021 | 4 | Lint/build/test + rà soát cuối |
