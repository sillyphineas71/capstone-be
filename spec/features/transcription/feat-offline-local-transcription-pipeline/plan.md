## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo plan.md ban đầu, tách từ `docs/Offline Meeting Transcription Pipeline Plan.md` và đối chiếu code thực tế (`src/modules/transcription`, `storage`, `queue`, `administration`). | Toàn bộ file (mới) |
| 2026-06-29 | Vá thiếu sót: mục 5.2 trước đó rút gọn `dto/`, `constants/`, `types/` thành folder-only, làm mất 3 file đã có trong bản gốc mục 7 (`docs/Offline Meeting Transcription Pipeline Plan.md`): `transcription-response.dto.ts`, `query-transcript.dto.ts`, `transcription-provider.type.ts`. Đã liệt kê lại đầy đủ từng file, khớp 1:1 với bản gốc, kèm task ID phụ trách. | Mục 5.2 |
| 2026-06-29 | Phát hiện gap thực tế qua kiểm tra codebase (không có seed permission `transcript.*`, không có task implement UC-127 PATCH segments): thêm `src/database/seeds/<timestamp>-SeedTranscriptionPermissions.ts` vào cấu trúc (tương ứng task mới `T-PERM-001` trong `tasks.md`, thuộc M1, chạy trước T005). Cập nhật số lượng task tổng (~47 → ~50) do thêm `T-PERM-001` (M1) và `T-EDIT-001` (M4) trong `tasks.md`. | Mục 2, 5.1, 5.2 |

# Implementation Plan: TRANS-OFFLINE-001 Offline Local Meeting Transcription Pipeline

**Branch**: `feat-offline-local-transcription-pipeline` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `spec/features/transcription/feat-offline-local-transcription-pipeline/spec.md`
**Nguồn quyết định gốc**: `docs/Offline Meeting Transcription Pipeline Plan.md` (đã qua nhiều vòng chốt với team/người dùng — xem changelog của file đó để biết lịch sử quyết định đầy đủ)

> **Đây là bước documentation-first. Không có code nào được viết trong phạm vi plan.md này.**

## 1. Feature Summary

Triển khai pipeline transcription chạy offline/self-hosted cho recording sau khi cuộc họp kết thúc, dùng `faster-whisper` (STT), `pyannote.audio` (diarization/overlap detection), `SpeechBrain SepFormer` (speech separation best-effort, chỉ khi có overlap). Audio lưu MinIO private bucket; điều phối job qua `background_jobs` + BullMQ; AI Worker chạy private network, không outbound internet runtime; model preload sẵn, không tải runtime; không gọi cloud STT/API ngoài.

Điểm khác biệt quan trọng so với một plan AI thông thường: feature này phải chạy được ở **2 môi trường năng lực phần cứng rất khác nhau** (laptop dev không GPU vs. production GPU tương lai chưa xác nhận), nên toàn bộ model/device/compute_type phải đọc từ `AI_PROFILE` config, không hard-code.

## 2. Technical Context

**Language/Version**: TypeScript 5.x trên NestJS (backend orchestration); Python 3.x (AI pipeline trong container AI Worker)
**Primary Dependencies**:
- Backend: `@nestjs/bullmq`, `bullmq`, `ioredis` (đã có, production-ready), `@nestjs/typeorm`, `class-validator`
- AI Worker (Python): `faster-whisper`, `pyannote.audio`, `speechbrain` (SepFormer), `ffmpeg` (qua subprocess), `psutil` (diagnostic/benchmark only — KHÔNG dùng cho quyết định resource-guard)
- Storage: cần thêm package client MinIO (ví dụ `minio` npm) cho `StorageService` — hiện chưa có (gap đã xác nhận)

**Storage**: PostgreSQL (DB Compact, bảng `transcripts`, `background_jobs`, `media_files`, `recording_sessions` — đã đủ cột, không migration); MinIO (audio gốc + file trung gian, private bucket); Redis (BullMQ broker, đã chạy)

**Testing**: Jest (unit/integration NestJS phía backend); pytest hoặc tương đương cho Python pipeline (chi tiết tool Python để team chốt ở Phase 0 research nếu cần, không bắt buộc phải là pytest)

**Target Platform**:
- Local Development: laptop dev, Intel Core i5-11300H (4 core/8 thread), 16GB RAM, Intel Iris Xe Graphics (KHÔNG NVIDIA CUDA)
- Production/High-Quality GPU mode: **future target, chưa có xác nhận ngân sách/timeline/instance type** — có thể là EC2 GPU hoặc máy khác có GPU NVIDIA đủ mạnh

**Project Type**: Backend modular monolith (NestJS) + 1 container AI Worker riêng (Node wrapper + Python subprocess)

**Performance Goals**:
- Local: không có mục tiêu performance — chỉ cần hoàn thành đúng luồng cho audio 2-5 phút.
- Production (future): audio 30-90 phút qua chunking, gần/nhanh hơn real-time tuỳ GPU — **không phải tiêu chí MVP**.

**Constraints**:
- Không cloud STT/API ngoài.
- AI Worker không outbound internet runtime (network-layer enforced).
- Model weights preload, không tải runtime.
- Không thêm bảng/permission mới.
- `AI_WORKER_MAX_CONCURRENT_JOBS=1` ở mọi profile trong MVP.

**Scale/Scope**: 1 module (`transcription`) mở rộng từ entity-only thành full CRUD/job-orchestration; 1 container AI Worker mới; ~50 task chia 4 milestone (xem mục 7).

## 3. Constitution Check

*GATE: Phải pass trước khi bắt đầu implement (ngoài phạm vi tài liệu này).*

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Không thêm bảng database mới | ✅ PASS | Dùng lại `transcripts`, `background_jobs`, `media_files`, `recording_sessions` — đã verify entity khớp 100% |
| Không thêm permission mới | ✅ PASS | Dùng `transcript.create/read/update` đã có trong registry |
| Không dùng Prisma / không đổi ORM | ✅ PASS | TypeORM, không động tới |
| Không tự ý thêm Kafka/Elastic/vector DB | ✅ PASS | Chỉ dùng Redis/BullMQ đã có |
| Không tự ý tích hợp cloud AI provider | ✅ PASS | Toàn bộ model self-hosted, no outbound internet |
| AI Document/transcription giữ feature-flag | ✅ PASS | `TRANSCRIPTION_ENABLED` flag, không bật mặc định sâu hơn yêu cầu |
| Markdown editing safety (AGENTS.md) | ✅ PASS | Đã kiểm tra BOM, không broad regex cho ID, đã verify sau khi sửa `docs/Offline Meeting Transcription Pipeline Plan.md` |

Không có vi phạm cần justify ở Complexity Tracking.

## 4. Môi trường triển khai (Local Development vs Production / High-Quality GPU)

> Chi tiết đầy đủ nằm ở `docs/Offline Meeting Transcription Pipeline Plan.md` mục 2.5, 8, 11, 12 — đây là tóm tắt phần liên quan trực tiếp tới việc lập kế hoạch thực thi.

### 4.1 Local Development Profile (`AI_PROFILE=local`) — MVP commitment

| Thành phần | Giá trị |
|---|---|
| Whisper model | `small` (mặc định) / `medium` (optional) |
| Device | `cpu` |
| Compute type | `int8` |
| Diarization | Bật, chậm trên CPU (chấp nhận được, chỉ để validate logic) |
| Overlap detection | Bật |
| SepFormer | OFF mặc định (`SEPARATION_ENABLED=false`), optional best-effort nếu bật, tự bị skip khi thiếu RAM |
| Audio input | 2-5 phút (`MAX_AUDIO_DURATION_LOCAL_SECONDS=300`) |
| Mục tiêu | Validate end-to-end flow, KHÔNG đo performance/chất lượng production |

### 4.2 Production / High-Quality GPU Profile (`AI_PROFILE=production-gpu`) — future target, KHÔNG phải MVP commitment

**Trạng thái xác nhận tại thời điểm viết plan: chưa có ngân sách, timeline, hoặc instance type cụ thể.** Mục này tồn tại để có sẵn kiến trúc/cấu hình đích khi GPU thật được duyệt, không phải để cam kết tiến độ MVP.

| Thành phần | Giá trị |
|---|---|
| Whisper model | `large-v3` |
| Device | `cuda` |
| Compute type | `float16` |
| SepFormer | Bật (`SEPARATION_ENABLED=true`) |
| Yêu cầu hạ tầng | GPU NVIDIA/CUDA bắt buộc — không phải "EC2 mạnh hơn là đủ"; EC2 CPU-only có cùng giới hạn như laptop hiện tại |

### 4.3 Cơ chế chuyển đổi

Chỉ qua biến môi trường `AI_PROFILE` + các biến model/device/compute_type liên quan. Không hard-code. Nếu `AI_PROFILE=production-gpu` mà container thiếu CUDA → fail fast (`CUDA_NOT_AVAILABLE_FOR_PROFILE`), không tự fallback CPU âm thầm.

## 5. Project Structure

### 5.1 Documentation (feature này)

```text
spec/features/transcription/feat-offline-local-transcription-pipeline/
├── spec.md                          # Đặc tả WHAT/WHY, EARS requirements, authorization, security policy
├── plan.md                          # File này — technical context, môi trường, milestone roadmap
├── tasks.md                         # ~50 task chia M1-M4, mỗi task có dependsOn/files/AC/test
├── quickstart.md                    # Hướng dẫn chạy local end-to-end
└── contracts/
    ├── transcription-api.md         # UC-125/126/127 + ghi chú lệch UC-128b
    └── ai-worker-result-schema.json # JSON Schema output của Python AI pipeline
```

### 5.2 Source Code (reuse vs cần tạo mới — xác nhận qua code review thực tế)

```text
src/modules/transcription/            # ĐÃ CÓ: chỉ có entity, module rỗng — CẦN THÊM toàn bộ controller/service/dto/processor
  transcription.module.ts             # ĐÃ CÓ (chỉ đăng ký TypeORM), cần wiring thêm
  transcription.controller.ts         # CẦN TẠO (T005, T006)
  transcription.service.ts            # CẦN TẠO (T005, T006, T009, T023, T029)
  transcription-worker.processor.ts   # CẦN TẠO (T008, T009 — BullMQ @Processor('transcription'))
  dto/
    create-transcription-job.dto.ts   # CẦN TẠO (T004)
    transcription-response.dto.ts     # CẦN TẠO (T006 — shape response GET transcript theo contracts/transcription-api.md)
    query-transcript.dto.ts           # CẦN TẠO (T006 — validate includeSegments/page/limit)
  entities/
    transcript.entity.ts              # ĐÃ CÓ, đủ cột — KHÔNG migration
  constants/
    transcription-job.constants.ts    # CẦN TẠO (T002A — job name/queue name constants)
    transcription-error-codes.ts      # CẦN TẠO (T005 — MEETING_NOT_FOUND, RECORDING_SESSION_NOT_FOUND, SOURCE_MEDIA_NOT_FOUND, TRANSCRIPTION_JOB_ALREADY_RUNNING, TRANSCRIPTION_DISABLED)
  types/
    transcript-segment.type.ts        # CẦN TẠO (T013 — mirror TypeScript của contracts/ai-worker-result-schema.json)
    transcription-provider.type.ts    # CẦN TẠO (T002A — type cho provider, chỉ chấp nhận `local_faster_whisper`, dùng lại ở T024)

src/modules/storage/                  # ĐÃ CÓ: chỉ driver `local` — CẦN THÊM driver MinIO/S3
  storage.service.ts                  # ĐÃ CÓ (driver local only, TODO S3 còn để trống) — CẦN MỞ RỘNG

src/modules/queue/                    # ĐÃ CÓ, production-ready — KHÔNG đổi
  queue.module.ts                     # Đã đăng ký QUEUE_TRANSCRIPTION_NAME — dùng lại
  queue.service.ts                    # Helper addJob() — dùng lại

src/modules/administration/
  entities/background-job.entity.ts   # ĐÃ CÓ, đủ enum BackgroundJobType.TRANSCRIPTION — KHÔNG đổi

src/database/seeds/
  <timestamp>-SeedTranscriptionPermissions.ts  # CẦN TẠO (T-PERM-001 — gap thực tế: chưa có seed nào cho transcript.create/read/update, đúng pattern SeedMediaFilesPermissions.ts đã có)

workers/ai-transcription/             # CẦN TẠO MỚI — container AI Worker riêng
  Dockerfile
  package.json
  src/
    ai-transcription.worker.ts        # Node: consume BullMQ, spawn Python, ghi DB
    transcription-job-runner.ts
    minio-audio-loader.ts
    transcript-result-writer.ts
    profile-config.ts                 # CẦN: đọc AI_PROFILE, validate, fail-fast nếu thiếu CUDA cho production-gpu
    resource-guard.ts                 # CẦN: os.freemem() check trước khi spawn Python
  python/
    transcribe_pipeline.py
    audio_preprocess.py
    whisper_runner.py
    diarization_runner.py
    overlap_detector.py
    sepformer_runner.py
    merge_segments.py
    schemas.py
  tests/
    fixtures/                         # Audio giả lập 2-5 phút (T-DATA-001) — KHÔNG audio thật

models/                               # Model volume — preload tại build/setup, KHÔNG runtime download
  faster-whisper-small/
  faster-whisper-medium/
  faster-whisper-large-v3/            # chỉ cần khi chuẩn bị production-gpu
  pyannote/
  speechbrain-sepformer/
```

**Structure Decision**: Modular monolith hiện có được giữ nguyên; pipeline AI tách thành container riêng (`workers/ai-transcription`) đúng theo quyết định kiến trúc gốc (Node consume BullMQ + spawn Python, không thêm message queue/Python queue mới).

## 6. API / Contract Plan

Endpoint chính theo `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 13 (UC-125, UC-126, UC-127) — xem chi tiết đầy đủ tại [contracts/transcription-api.md](./contracts/transcription-api.md):

- `POST /api/v1/meetings/{meetingId}/transcription-jobs` — tạo job (UC-125, `transcript.create`).
- `GET /api/v1/meetings/{meetingId}/transcript` — xem transcript (UC-126, `transcript.read`).
- `PATCH /api/v1/transcripts/{transcriptId}/segments` — sửa thủ công (UC-127, `transcript.update`).
- Background job status: dùng endpoint `background_jobs` hiện có nếu sẵn (mục 22.13 `AGENTS.md`), không tạo route mới nếu đã có.

**Lệch khỏi API_CONTRACT cần ghi nhận**: UC-128b (`POST /api/v1/internal/transcription/callbacks`) mô tả mô hình external STT provider callback qua HMAC — không dùng trong kiến trúc AI Worker nội bộ này (xem `spec.md` CLR-001). Endpoint này giữ nguyên trong API_CONTRACT cho khả năng tích hợp tương lai, không bị xoá, nhưng không nằm trong scope implementation của feature này.

## 7. Lộ trình triển khai theo milestone (M1-M4)

> Milestone hoá để có điểm dừng an toàn cho timeline capstone — chi tiết task đầy đủ ở `tasks.md`. Đây là tóm tắt cấp plan.

| Milestone | Nội dung | Bắt buộc? |
|---|---|---|
| **M1 — Lõi STT** | Setup module, config/profile architecture (T002A-E), data prep (T-DATA-001), benchmark (T-BENCH-001), storage adapter (T-STORAGE-001), API + DB integration, BullMQ orchestration, MinIO access, audio preprocessing, faster-whisper runner | **Bắt buộc** — giá trị tối thiểu phải có |
| **M2 — Diarization + Overlap** | Xin quyền HuggingFace gated model (T-HF-001), pyannote diarization runner, overlap detection, align STT với diarization | Nâng cao, nên làm nếu kịp |
| **M3 — SepFormer best-effort** | SepFormer runner optional, process separated overlap audio | **Optional — có thể cắt hoàn toàn** nếu hết thời gian, không phá vỡ M1/M2 |
| **M4 — Hoàn thiện** | Transcript persistence, security hardening, notification/manual review, testing, documentation/demo | Làm đan xen song song với M1-M3 ngay khi phần tương ứng xong |

Nguyên tắc chốt: demo capstone tối thiểu = M1 hoàn chỉnh + phần M4 tương ứng. M2 nâng cao nếu kịp. M3 chấp nhận cắt.

## 8. Authorization Plan

- Mọi endpoint người dùng đều yêu cầu JWT + permission (`transcript.create`/`read`/`update`) — không có endpoint public trong feature này.
- Business rule bổ sung NGOÀI permission node (permission chỉ là điều kiện cần, không đủ):
  - Tạo job: phải là Host/Organizer của đúng meeting, hoặc Business Admin/System Admin.
  - Xem transcript: phải là Host/Organizer hoặc `meeting_participants` hợp lệ của đúng meeting, hoặc Business Admin/System Admin.
  - Sửa transcript: chỉ Host/Organizer hoặc Business Admin/System Admin — participant thường không được sửa (NGHIÊM NGẶT hơn quyền xem, theo `AGENTS.md` mục 20.2 "dữ liệu nhạy cảm phải kiểm tra quyền kỹ hơn CRUD thông thường").
- AI Worker không đi qua RBAC vì chạy trong process backend nội bộ, không gọi HTTP API của chính nó.
- Không tạo permission mới (`transcript.approve` không được thêm — xem CLR-002 trong spec.md).

## 9. Risks & Mitigations

> Đầy đủ ở `docs/Offline Meeting Transcription Pipeline Plan.md` mục 11 (R1-R6). Tóm tắt rủi ro lớn nhất ảnh hưởng kế hoạch:

- **Risk**: Laptop dev không có GPU/CUDA → không thể dùng để đánh giá chất lượng production.
  - **Mitigation**: Tách rõ Local/Production profile (mục 4), không ai dùng kết quả local để benchmark.
- **Risk**: `StorageService` hiện chưa có driver MinIO/S3 thật, dù container MinIO đã chạy.
  - **Mitigation**: T-STORAGE-001 đặt làm tiền điều kiện cho T010, nằm đầu M1.
- **Risk**: pyannote là gated model trên HuggingFace — nếu không xin quyền trước, Phase 6/M2 sẽ bị block.
  - **Mitigation**: T-HF-001 chỉ định assignee cụ thể, thực hiện trước T016.
- **Risk**: SepFormer là model nặng nhất, có thể làm laptop 16GB RAM quá tải.
  - **Mitigation**: Default OFF ở local, có resource guard tự skip (T002E), toàn bộ M3 có thể cắt mà không ảnh hưởng M1/M2.
- **Risk**: `AI_WORKER_MIN_FREE_RAM_MB=2048` là số đoán, chưa đo thật.
  - **Mitigation**: T-BENCH-001 đo thật trên máy dev, cập nhật lại threshold.

## 10. Testing Strategy

Xem chi tiết test requirement theo từng task ở `tasks.md`. Tổng quan:

- **Unit test**: tạo transcription job (validation, authorization, conflict), speaker assignment logic (không ép gán khi confidence thấp), resource guard (T002B/T002C/T002E).
- **Integration test**: BullMQ job lifecycle (queued → running → completed/failed), đồng bộ `background_jobs`/`transcripts`.
- **Smoke test**: chạy pipeline Python với audio mẫu thật (T-DATA-001) — không overlap và có overlap.
- **Security test**: AI Worker container không có outbound internet (network-layer), nhưng truy cập được Redis/MinIO nội bộ.

## 11. Complexity Tracking

Không có vi phạm Constitution Check cần justify.

## 12. Acceptance Criteria Traceability

| Acceptance Criteria từ spec.md | Plan coverage |
|---|---|
| AC-001, AC-002 (happy path tạo job + xem transcript) | Mục 5, 6, 7 (M1) |
| AC-003 (validation) | Mục 6, `tasks.md` T004 |
| AC-004, AC-005 (authorization) | Mục 8 |
| AC-006 (conflict job đang chạy) | Mục 6, `tasks.md` T005 |
| AC-007, AC-008 (profile guard) | Mục 4, 9, `tasks.md` T002B/T002C |
| AC-009, AC-010 (overlap/SepFormer best-effort) | Mục 7 (M2/M3), 9 |
| AC-011 (draft, không auto approve) | Mục 8 (authorization), `spec.md` mục 5.4 |
