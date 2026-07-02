## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo tasks.md ban đầu, tách từ `docs/Offline Meeting Transcription Pipeline Plan.md` mục 9, chia theo milestone M1-M4, bổ sung `dependsOn`, `files`, `acceptance criteria`, `test requirement` cho mỗi task. | Toàn bộ file (mới) |
| 2026-06-29 | Vá thiếu sót: gán cụ thể file tạo `types/` (T013 tạo thêm `transcript-segment.type.ts`) và `constants/transcription-error-codes.ts` (T005) — 2 file này đã được nhắc trong `plan.md` mục 5.2 nhưng chưa gán cho task nào. | T005, T013 |
| 2026-06-29 | Vá thiếu sót lần 2 (đối chiếu lại với mục 7 gốc trong `docs/Offline Meeting Transcription Pipeline Plan.md`): gán thêm `transcription-response.dto.ts` + `query-transcript.dto.ts` vào T006, và `transcription-provider.type.ts` vào T002A — 3 file này có trong bản gốc nhưng bị rút gọn mất khi viết `plan.md` mục 5.2 ban đầu. | T002A, T006 |
| 2026-06-29 | Kiểm tra readiness cho M1, phát hiện 2 gap thực tế qua review codebase (không chỉ review tài liệu): (1) chưa có seed permission `transcript.create/read/update` nào trong `src/database/seeds/` — nếu không seed, mọi RBAC guard sẽ fail; thêm `T-PERM-001`, đặt trước T005, M1. (2) `spec.md`/`contracts/transcription-api.md` đã định nghĩa đầy đủ UC-127 (PATCH segments, authorization `transcript.update`) nhưng chưa task nào implement nó; thêm `T-EDIT-001`, đặt sau T023, M4 (không block M1 Independent Test). | T-PERM-001 (mới, trước T005), T-EDIT-001 (mới, sau T023) |
| 2026-06-30 | Quyết định mới sau khi chạy thật M1 trên dữ liệu tiếng Việt: (1) đổi default `WHISPER_MODEL` của profile `local` từ `small` sang `medium` — `small` cho chất lượng quá thấp với tiếng Việt; (2) thêm profile `local-quality-test` (`large-v3`+cpu+int8, cap 180s, tắt diarization/overlap/separation) chỉ để benchmark 1 lần, không dùng dev hằng ngày; (3) thêm `T014B` — so sánh chất lượng small/medium/large-v3 trên cùng 1 sample tiếng Việt; (4) bổ sung `initialPrompt`/custom vocabulary cho `whisper_runner.py` (qua job payload hoặc `WHISPER_INITIAL_PROMPT` env), `condition_on_previous_text=false` + `repetition_penalty`/`no_repeat_ngram_size` để chặn hallucination-loop lặp từ đã gặp thật khi test. | T002A (mục 8 — model default), T014, T014B (mới) |
| 2026-06-30 | Phát hiện qua review codebase: quyết định đổi default `WHISPER_MODEL` sang `medium` (mục trên) đã code đúng trong `profile-config.ts` nhưng `workers/ai-transcription/.env` và `.env.example` thật vẫn còn hard-code `WHISPER_MODEL=small` (env var override default code) — fix hallucination-loop không có hiệu lực khi chạy thật nếu không sửa 2 file env này. Đã sửa `.env`/`.env.example` sang `medium`. Đã chạy `T014B` thật trên máy dev: `small` vs `medium` (kết quả + bảng số liệu ghi ở `quickstart.md` mục "T014B"); `large-v3` chưa benchmark được do máy dev thiếu dung lượng đĩa (~2.5GB trống, cần ~3GB) — task `T014B` coi là **chưa hoàn tất 100%**, cần chạy lại `large-v3` trên máy đủ dung lượng. Phát hiện thêm: fixture `sample-domain-vocabulary.wav` gốc bị sinh nhầm bằng giọng TTS tiếng Anh, đã thay bằng giọng tiếng Việt thật (`vi-VN-HoaiMyNeural` qua `edge-tts`) — xem changelog `tests/fixtures/README.md`. | `workers/ai-transcription/.env`, `.env.example`, `quickstart.md` (mục T014B mới), `tests/fixtures/sample-domain-vocabulary.wav`, `tests/fixtures/README.md` |
| 2026-07-01 | **Wave 4 (roadmap) — M4 Review/Edit + Notification**: (1) **T-EDIT-001 / UC-127** ✅ — `PATCH /api/v1/transcripts/:transcriptId/segments`: controller mới `transcript-segments.controller.ts` (base path `transcripts`, KHÁC `meetings/:meetingId`), `UpdateTranscriptSegmentsDto` (+6 validation test), service `updateTranscriptSegments`: authz Host/Admin (participant thường 403), all-or-nothing validate segmentId (404 SEGMENT_NOT_FOUND), sửa text/speakerLabel/speakerUserId (→ speakerSource='manual'), tăng `editRevisionNo` (lưu trong `speaker_segments_json` — KHÔNG thêm cột, tránh migration), set `edited_by`/`edited_at`, **KHÔNG đổi status** (giữ draft — FR-042/CLR-002); permission `transcript.update` (đã seed) làm gate thô. 5 service test. (2) **T028** ✅ — `updateTranscriptResult` tính transcript-level `manualReviewRequired` + `manualReviewSegmentCount` từ segment low-confidence, lưu vào JSON (không thêm bảng/workflow). 1 test. (3) **T029** ✅ — `notifyTranscriptReady()` gửi in-app notification cho Host sau khi transcript draft (thêm `NotificationType.TRANSCRIPT_READY`); processor gọi sau `markCompleted`; **fail-safe** (try/catch nội bộ, notification lỗi KHÔNG fail job). 3 service test + 1 processor test. Thêm `NotificationsModule` vào imports của TranscriptionModule (không cycle). (4) **T021/T022/T023** ✅ (xác nhận đã done qua `updateTranscriptResult`) — build final transcript JSON (`speaker_segments_json` với segments/modelVersions/warnings), `detected_speakers_json`, status→draft (không tự reviewed/approved); KHÔNG có `transcript-result-writer.ts` riêng vì result-writing làm ở backend service, không phải Node worker. Verify: backend build pass, **66 transcription+admin test pass**, integration test (T032) vẫn PASS với wiring mới. | `src/modules/transcription/transcript-segments.controller.ts` (mới), `dto/update-transcript-segments.dto.ts` (+`.spec`), `transcription.service.ts` (+`updateTranscriptSegments`/`notifyTranscriptReady`/T028), `transcription-worker.processor.ts` (gọi notify + `NOT_PRELOADED`), `transcription.module.ts` (NotificationsModule + controller), `notifications/entities/notification.entity.ts` (TRANSCRIPT_READY), `transcription.service.spec.ts`/`transcription-worker.processor.spec.ts` (mock + test mới), `test/transcription-job-lifecycle.e2e-spec.ts` (cleanup notifications) |
| 2026-07-01 | **Wave 3 (roadmap) — M4 Security & Infra**: (1) **T026** ✅ (mới) — `src/model-validation.ts` `validateModelsAvailable()`: fail-fast trước khi spawn Python nếu model cần theo profile chưa preload (whisper path nếu set, pyannote config.yaml khi diarization on, sepformer khi separation on); wire vào `runTranscriptionJob` sau `loadProfile`; thêm `NOT_PRELOADED` vào `isNonRetryableError` (processor) để không retry lỗi cấu hình; 9 unit test (`model-validation.spec.ts`). (2) **T027** ✅ (mới) — audit toàn bộ log worker: KHÔNG log secret/token/raw-transcript/storage-secret (chỉ jobId/profile/status); thêm `src/logging-policy.spec.ts` (3 test) capture console.error + assert không lọt secret env / không field rawText/cleanedText/accessKey/token. (3) **T024/T025 code-level** ✅ — thêm `python/no_external_stt_test.py` (2 test): scan tĩnh toàn bộ pipeline Python KHÔNG có lib cloud STT/egress (openai/google.cloud/boto3/httpx/requests/socket...) + assert `diarization_runner` ép `HF_HUB_OFFLINE=1` và chặn cứng `PYANNOTE_LOCAL_FILES_ONLY!=true`. Scan xác nhận sạch. (4) **T035A** xác nhận đã phủ sẵn (resource-guard.spec: audio quá dài, low RAM skip SepFormer; profile-config.spec: CUDA fail-fast). (5) **T025/T035 infra** 🟢 — **trung thực về kiến trúc**: AI worker chạy như subprocess backend (không container riêng), nên cô lập mạng áp ở container backend. Backend CHƯA dockerize nên test curl-từ-container chưa chạy được; bù lại guard offline tầng code đã verify hoạt động thật (M2 debug: thiếu PYANNOTE_CACHE → `OfflineModeIsEnabled` thay vì gọi mạng). Ghi chú triển khai network-isolation (network `internal: true`, env offline, model volume RO, quy trình curl verify) vào `docker-compose.dev.yml` + `quickstart.md` mục "Security Verification" (viết lại đầy đủ 2 tầng: code-level verify-được-ngay + container-level infra-target). | `workers/ai-transcription/src/model-validation.ts` (mới) + `.spec.ts` (mới), `src/transcription-job-runner.ts` (wire validateModelsAvailable), `src/modules/transcription/transcription-worker.processor.ts` (NOT_PRELOADED), `workers/.../src/logging-policy.spec.ts` (mới), `workers/.../python/no_external_stt_test.py` (mới), `workers/.../src/transcription-job-runner.spec.ts` (set PYANNOTE_MODEL_PATH cho test M2), `docker-compose.dev.yml` (ghi chú T025), `quickstart.md` (Security Verification) |
| 2026-07-01 | **Wave 2 (roadmap) — Hoàn tất M2, thoả "M2 Independent Test" (lần đầu chạy thật)**: (1) **T-DATA-001 phần overlap** ✅ — tạo `tests/fixtures/sample-overlap.wav` (4 clip TTS, 2 giọng `vi-VN-HoaiMyNeural`+`vi-VN-NamMinhNeural` qua `edge-tts`, ghép timeline có khoảng lặng + 1 vùng chồng tiếng: A-alone → silence → A+B overlap → silence → B-alone). Khoảng lặng để VAD tách segment. (2) **T031** ✅ — `merge_segments_test.py` đã có đủ 4 case bắt buộc + thêm 1 regression case (fragmented same-speaker), tổng 9 test pass. (3) **T034** ✅ — tạo `python/smoke_overlap_test.py`: chạy THẬT pipeline đầy đủ M2 trên fixture overlap, assert `detectedSpeakers>=2` + segment `overlap=true` + best-effort (unknown/manualReview, không crash khi SepFormer off). Gate `RUN_SMOKE=1`, PASS (26s). **Fix correctness thật trong merge logic (T018)**: chạy thật phát hiện pyannote fragment 1 speaker thành nhiều turn ngắn (7 turn cho 3 vùng nói), khiến `_best_matching_turn` cũ (lấy 1 turn đơn lớn nhất) cho overlapRatio 0.585 < ngưỡng 0.65 → gán "unknown" OAN cho speaker rõ ràng chiếm ~88% segment. Đổi sang `_dominant_speaker` **cộng dồn overlap theo từng speaker label** rồi chọn speaker chiếm ưu thế (ratio 0.88 → gán đúng Speaker_1). Đúng intent T018 ("gán speaker chiếm ưu thế"), robust hơn với fragmentation. **8 test cũ vẫn pass nguyên (backward-compatible** — các case cũ mỗi segment đã do 1 speaker chiếm ưu thế nên kết quả không đổi). **Kết quả M2 Independent Test thật**: seg-0000(A)→Speaker_1, seg-0001(overlap)→unknown/overlap=true, seg-0002(B)→Speaker_2, detectedSpeakers=2. | `tests/fixtures/sample-overlap.wav` (mới), `tests/fixtures/README.md`, `python/smoke_overlap_test.py` (mới), `python/merge_segments.py` (`_best_matching_turn`→`_dominant_speaker`, cộng dồn theo speaker), `python/merge_segments_test.py` (+1 regression case) |
| 2026-07-01 | **T-BENCH-001 hoàn thành** (Wave 1.5): tạo harness `workers/ai-transcription/python/benchmark_resources.py` (sample RSS process+children qua psutil, lấy peak). Đo thật trên máy dev (CPU/int8, `sample-no-overlap.wav`): `small`+STT = 836MB/24s, `medium`+STT = 1756MB/70s, `medium`+diarization (M2, nặng nhất hiện có) = 2583MB/155s. **Phát hiện**: giá trị đoán `AI_WORKER_MIN_FREE_RAM_MB=2048` THẤP hơn cả peak thật path M2 (2583MB) → đoán sai. Đã nâng default profile `local` trong `profile-config.ts` + `.env`/`.env.example` lên **4096** (peak×1.5 làm tròn 512, đồng bộ production profiles). Bảng số đo ghi vào `quickstart.md` mục "T-BENCH-001". `resource-guard.spec.ts` dùng 2048/4096 chỉ là fixture minh hoạ logic so sánh (không phải threshold production) — không đổi. **Còn nợ**: combo `+SepFormer` chưa đo được vì M3 chưa implement — đo lại khi có M3. | `workers/ai-transcription/python/benchmark_resources.py` (mới), `workers/ai-transcription/src/profile-config.ts` (local default 2048→4096), `.env`, `.env.example`, `quickstart.md` (mục T-BENCH-001) |
| 2026-07-01 | **Wave 1 (roadmap) — dựng lưới test an toàn cho M1**: (1) **T033** ✅ — tạo `workers/ai-transcription/python/transcribe_pipeline_smoke_test.py`: chạy THẬT `transcribe_pipeline.py` (preprocess→whisper) trên `sample-no-overlap.wav`, validate output bằng chính `schemas.validate_result()` (validator T013) + assert nghiệp vụ M1; gate sau env `RUN_SMOKE=1` để không làm chậm suite mặc định (whisper CPU ~99s). Verify: PASS. (2) **T030** xác nhận đã phủ đủ sẵn (15 test pass, ≥8 AC case). (3) **T032** ✅ — tạo `test/transcription-job-lifecycle.e2e-spec.ts`: integration test CHẠY THẬT qua Postgres + Redis live (không mock DB/queue) — seed FK-valid (user/meeting/recording_session/media_file/host) bằng raw SQL → `createTranscriptionJob` (enqueue BullMQ thật) → `TranscriptionWorkerProcessor` consume từ Redis thật → mock DUY NHẤT `runAiWorker` (phần spawn Python+MinIO) trả canned result → assert `background_jobs.status=completed` + `transcripts.status=draft` + segments lưu đúng. Gate sau `RUN_INTEGRATION=1`. Verify: PASS (`RUN_INTEGRATION=1 jest --config test/jest-e2e.json --runInBand --forceExit`). **2 gap hạ tầng phát hiện & sửa khi làm**: (a) `test/jest-e2e.json` thiếu `moduleNameMapper` strip `.js` (có trong jest config unit ở package.json nhưng e2e config thiếu) → MỌI e2e không resolve được import `../src/*.js` — đã thêm; (b) boot AppModule dưới ts-jest treo 0-byte output vì `StorageService.onModuleInit()` gọi dynamic `import('minio')` mà CommonJS/ts-jest không chạy được nếu thiếu `--experimental-vm-modules` → override `StorageService` no-op trong test (an toàn: test không đụng storage thật, phần MinIO nằm trong `runAiWorker` đã mock; đã verify không service nào khác gọi storage lúc boot). | `workers/ai-transcription/python/transcribe_pipeline_smoke_test.py` (mới), `test/transcription-job-lifecycle.e2e-spec.ts` (mới), `test/jest-e2e.json` (thêm moduleNameMapper) |
| 2026-06-30 | **T007 hoàn thành — vá gap thật**: endpoint `GET /api/v1/background-jobs/:id` (mà `quickstart.md` Step 7 + `contracts/transcription-api.md` mục "Background Job Status" + CLAUDE.md mục 22.13 đều giả định "reuse endpoint hiện có") **thực ra chưa từng tồn tại** — chỉ có `BackgroundJobsService` (nội bộ, dùng bởi worker), không có controller nào expose ra HTTP. Đã implement: `BackgroundJobsController` (`src/modules/administration/controllers/`), method `getJobStatusForUser` + `BackgroundJobStatusResponseDto`. **Authorization** (KHÔNG dùng `@RequirePermissions` vì `background_job.*` chưa được seed — đúng bug đã ghi ở T-PERM-001, dùng sẽ 403 mọi user): JwtAuthGuard + check trong service "owner (`requested_by`) HOẶC role BUSINESS_ADMIN/SYSTEM_ADMIN". Response **tối giản, không leak field nội bộ** (không trả `inputJson`/`metadataJson`/`requestedBy`); `errorMessage` chỉ khi failed, `result`(=outputJson) chỉ khi completed. `AdministrationModule` (@Global) thêm `import AuthModule` — xác nhận an toàn không cycle (AuthModule không import ngược, không inject service của administration). Verify: `npm run build` pass, 7 unit test mới (`background-jobs.service.spec.ts`: owner xem được/admin xem được/stranger 403/not-found 404/completed→result/failed→errorMessage/không-leak-field) pass; e2e spec (`test/background-job-status.e2e-spec.ts`) tạo theo pattern repo (DB-gated như các e2e khác, có TODO token helper). **Còn nợ liên quan (không thuộc T007)**: response của POST tạo job (`contracts` UC-125) có field `estimatedCompletion` nhưng service chưa trả — gap nhỏ riêng, chưa sửa trong lần này. | `src/modules/administration/controllers/background-jobs.controller.ts` (mới), `src/modules/administration/dto/background-job-status-response.dto.ts` (mới), `src/modules/administration/services/background-jobs.service.ts` (thêm `getJobStatusForUser`/`toStatusView`/`userHasAdminRole`, inject `DataSource`), `src/modules/administration/services/background-jobs.service.spec.ts` (mock `DataSource` + 7 case mới), `src/modules/administration/administration.module.ts` (import `AuthModule` + đăng ký controller), `test/background-job-status.e2e-spec.ts` (mới), `quickstart.md` (Step 7) |
| 2026-06-30 | **T-HF-001 hoàn thành thật + T016 verify thật bằng model pyannote thật (không còn chỉ unit test mock)** — user tự accept license HuggingFace cho `pyannote/speaker-diarization-3.1`/`pyannote/segmentation-3.0` + tạo access token READ, set `HF_TOKEN` persistent ở User-scope. Agent dùng token (đọc qua registry, không in ra giá trị/không log) để: (1) `snapshot_download` `pyannote/segmentation-3.0` + `pyannote/wespeaker-voxceleb-resnet34-LM` (embedding, public) vào HF cache chuẩn; (2) copy snapshot `speaker-diarization-3.1` (chứa `config.yaml`) vào `models/pyannote/speaker-diarization-3.1/` đúng cấu trúc `PYANNOTE_MODEL_PATH` mà `diarization_runner.py` yêu cầu. Trong lúc verify thật, phát hiện và sửa **6 lỗi tương thích môi trường thật** (không phải bug logic của ta, nhưng phải patch mới chạy được) trong `diarization_runner.py` — toàn bộ patch có docstring giải thích rõ root cause, đã verify qua 7 unit test (`diarization_runner_test.py`) + chạy thật `diarize()`/`transcribe_pipeline.py --diarization-enabled true` trên audio thật, output đúng schema (`speakerLabel`, `diarizationConfidence`, `detectedSpeakers`, fallback `unknown` khi dưới ngưỡng): (1) `torchaudio.AudioMetaData` đã bị bỏ khỏi torchaudio mới — stub class; (2) `huggingface_hub.hf_hub_download` đã bỏ kwarg `use_auth_token` (chỉ còn `token`) — wrap kwarg; (3) `torch>=2.6` đổi default `weights_only=True` cho `torch.load`, checkpoint pickle cũ của pyannote bị từ chối — patch tạm `weights_only=False` chỉ trong cửa sổ `Pipeline.from_pretrained()`, khôi phục ngay sau, vì nguồn checkpoint đã verify qua license/token chính chủ; (4) `pyannote.audio` dùng `cache_dir` RIÊNG (`PYANNOTE_CACHE`, mặc định `~/.cache/torch/pyannote`) khác hẳn cache chuẩn `huggingface_hub` (`~/.cache/huggingface/hub`) — phải set `PYANNOTE_CACHE` trỏ đúng cache đã preload, nếu không model nested coi như "chưa preload" dù đã tải; (5) bug path-separator THẬT trong `speechbrain.utils.importutils.LazyModule.ensure_module` (check `endswith("/inspect.py")` kiểu Unix, không khớp path Windows `\`) khiến cơ chế tự bảo vệ lazy-import của speechbrain không kích hoạt được trên Windows, gây crash khi `inspect.stack()` (gọi từ `pytorch_lightning`) vô tình chạm submodule lazy `speechbrain.integrations.k2_fsa` (thiếu package optional `k2`) — patch lại đúng logic gốc dùng `os.path.basename`; (6) `torchaudio.load()`/`torchaudio.info()` mới chỉ dùng `torchcodec` (cần FFmpeg shared DLL chưa cài đúng trên máy dev Windows) — patch thay bằng `soundfile` (dependency có sẵn, pure wheel); **bug thật của chính patch (6) khi mới viết**: quên forward `frame_offset`/`num_frames` khi đọc audio theo cửa sổ (luôn đọc full file) — gây `RuntimeError: Sizes of tensors must match` khi `torch.vstack` nhiều window lệch độ dài, và ở 1 file audio cụ thể (`sample-no-overlap.wav`, nhiều khoảng lặng/segment ngắn) gây **Segmentation fault thật** (crash native, không bắt được bằng Python exception) — đã sửa forward đúng `frame_offset`/`num_frames` qua `soundfile.read(..., start=, stop=)`; verify lại cả 2 audio fixture chạy sạch, không còn segfault. Lúc debug có cài thử dependency `torchcodec` để xem có giải quyết được lỗi DLL không — xác nhận **KHÔNG cần** package này: patch (6) đã thay thế hẳn `torchaudio.load`/`torchaudio.info` bằng `soundfile`, nên entry point duy nhất gọi `torchcodec` (`torchaudio._torchcodec.load_with_torchcodec`) không bao giờ được gọi nữa; `grep` xác nhận `pyannote.audio` cũng không import `torchcodec` trực tiếp ở đâu. Không thêm `torchcodec` vào `requirements.txt`. Thêm `PYANNOTE_CACHE` vào `.env`/`.env.example` (xem gap (4) ở trên). **Follow-up chưa giải quyết, cần xác minh ở T035**: lúc chạy `transcribe_pipeline.py --diarization-enabled true` thật, console có in 1 dòng cảnh báo lạ "You are sending unauthenticated requests to the HF Hub" dù `HF_HUB_OFFLINE=1` đã set trước khi import `pyannote.audio` (đã verify cơ chế block hoạt động đúng ở bước debug `LocalEntryNotFoundError`/`OfflineModeIsEnabled` trước đó) — grep toàn bộ site-packages không tìm ra chuỗi gốc của cảnh báo này, có thể đến từ 1 lib transitive không cài permanent trong site-packages thường (hoặc warning bị format động). Không chặn chức năng (pipeline vẫn chạy đúng, offline thật theo test trước), nhưng cần xác nhận lại bằng network capture thật (theo đúng cách T035 đã định nghĩa — exec container, thử curl ra ngoài) trước khi coi M2 đạt 100% yêu cầu "không outbound internet" của T025. | `workers/ai-transcription/python/diarization_runner.py` (6 compat shim mới + fix bug nội bộ patch (6)), `workers/ai-transcription/python/diarization_runner_test.py` (no-op shim mới trong fixture test, tránh torch import instability), `workers/ai-transcription/models/pyannote/speaker-diarization-3.1/` (model thật, gitignored), `workers/ai-transcription/.env`, `.env.example` (`PYANNOTE_CACHE` mới) |

# Tasks: TRANS-OFFLINE-001 Offline Local Meeting Transcription Pipeline

**Input**: Design documents from `spec/features/transcription/feat-offline-local-transcription-pipeline/`
**Prerequisites**: `spec.md`, `plan.md`, `contracts/transcription-api.md`, `contracts/ai-worker-result-schema.json`

**Tests**: Bao gồm test requirement cho mọi task vì `spec.md` (NFR-017) và `plan.md` (mục 10) yêu cầu rõ test coverage.

**Organization**: Task được nhóm theo **milestone M1-M4** (không theo user story), giữ nguyên Task ID gốc từ `docs/Offline Meeting Transcription Pipeline Plan.md` để truy vết. Task mới dùng prefix `T-XXX-NNN` để không phải renumber các task gốc T001-T038.

**Không code ở bước này** — tasks.md chỉ mô tả kế hoạch thực thi, chưa implement.

## Format mỗi task

```text
### [TaskID] — [Title]

- dependsOn: [Task ID khác, hoặc "Không có"]
- files: [đường dẫn file dự kiến chạm tới — (mới)/(sửa)]
- acceptance criteria: [điều kiện coi là xong]
- test requirement: [loại test + nơi viết test]
```

## Path Conventions

- Backend NestJS: `src/modules/transcription/`, `src/modules/storage/`, `src/modules/administration/`
- AI Worker (Node wrapper): `workers/ai-transcription/src/`
- AI Worker (Python pipeline): `workers/ai-transcription/python/`
- Test fixtures: `workers/ai-transcription/tests/fixtures/`
- E2E test backend: `test/*.e2e-spec.ts`
- Model volume: `models/`

---

## Milestone M1 — Lõi STT (bắt buộc, giá trị tối thiểu phải có)

**Goal**: Tạo transcription job → BullMQ → AI Worker → faster-whisper (`small`/`medium`, CPU, `int8`) → có raw transcript text lưu vào `transcripts`. Không phụ thuộc diarization/separation.

**Independent Test**: Gọi `POST /api/v1/meetings/{meetingId}/transcription-jobs` với audio mẫu 2-5 phút (T-DATA-001), xác nhận job hoàn tất và `GET .../transcript` trả `status=draft` với `rawText` không rỗng.

### Phase 0 — Source alignment & scope lock

#### T001 — Đọc source-of-truth và ghi lại quyết định scope

- dependsOn: Không có
- files: `spec.md`, `plan.md` (đã hoàn thành trong bước documentation-first này)
- acceptance criteria: Liệt kê đúng bảng dùng (`transcripts`, `media_files`, `background_jobs`, `recording_sessions`); không đề xuất bảng mới (`transcript_segments`, `audio_segments`, `speaker_profiles` đều bị cấm).
- test requirement: Không cần test code — verify bằng review tài liệu (checklist cuối `spec.md`).

#### T002 — Kiểm tra codebase hiện tại của modules liên quan

- dependsOn: T001
- files: Không tạo file mới (research) — kết quả ghi vào `plan.md` mục 5.2.
- acceptance criteria: Biết chính xác `TranscriptEntity`/`BackgroundJobEntity` đã tồn tại; `TranscriptionModule` chỉ có entity (chưa có controller/service/processor); `StorageService` chỉ có driver `local`; `QueueModule`/`QueueService` đã production-ready.
- test requirement: Không cần test code.

### Phase 0.5 — Config & Resource Profile Architecture

#### T002A — Định nghĩa AI_PROFILE và bảng cấu hình model/device/compute_type

- dependsOn: T002
- files: `workers/ai-transcription/src/profile-config.ts` (mới), `src/modules/transcription/constants/transcription-job.constants.ts` (mới), `src/modules/transcription/types/transcription-provider.type.ts` (mới — type chỉ chấp nhận `local_faster_whisper`, dùng lại ở T024)
- acceptance criteria: Đổi `AI_PROFILE` trong `.env` đổi toàn bộ hành vi worker mà không sửa code; map đúng `WHISPER_MODEL/DEVICE/COMPUTE_TYPE`, `DIARIZATION_ENABLED`, `OVERLAP_DETECTION_ENABLED`, `SEPARATION_ENABLED`, `MAX_AUDIO_DURATION_LOCAL_SECONDS` theo mục 8 của plan gốc; `TRANSCRIPTION_PROVIDER` chỉ nhận giá trị `local_faster_whisper`.
- test requirement: Unit test `profile-config.spec.ts` cho 3 profile (`local`, `production-gpu`, `production-cpu-fallback`).

#### T002B — Resource guard: giới hạn duration audio khi local

- dependsOn: T002A
- files: `workers/ai-transcription/src/resource-guard.ts` (mới)
- acceptance criteria: Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject trước khi load model với error `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`; audio ngắn hơn xử lý tiếp bình thường.
- test requirement: Unit test `resource-guard.spec.ts` — case audio 360s bị reject ở local + limit 300s, case audio 240s pass.

#### T002C — Fail-fast khi thiếu GPU cho production-gpu

- dependsOn: T002A
- files: `workers/ai-transcription/src/profile-config.ts` (sửa — thêm CUDA detection ở startup)
- acceptance criteria: `AI_PROFILE=production-gpu` mà container không detect CUDA → worker unhealthy/crash rõ với `CUDA_NOT_AVAILABLE_FOR_PROFILE` ngay khi start; không tự fallback CPU âm thầm.
- test requirement: Unit test `profile-config.spec.ts` — mock môi trường không CUDA + profile `production-gpu`.

#### T002D — Logging model/device/compute_type đang dùng cho mỗi job

- dependsOn: T002A
- files: `workers/ai-transcription/src/ai-transcription.worker.ts` (mới)
- acceptance criteria: Mỗi job log `jobId`, `aiProfile`, `whisperModel`, `device`, `computeType`, `diarizationEnabled`, `separationEnabled`, thời gian xử lý từng giai đoạn — không log nội dung nhạy cảm.
- test requirement: Unit test assert log output structure (không assert nội dung transcript trong log).

#### T002E — Cơ chế downgrade/skip an toàn khi local thiếu tài nguyên

- dependsOn: T002B, T002D
- files: `workers/ai-transcription/src/resource-guard.ts` (sửa)
- acceptance criteria: `AI_PROFILE=local` + RAM khả dụng (đo bằng Node `os.freemem()` trước khi spawn Python) dưới `AI_WORKER_MIN_FREE_RAM_MB` → tự skip SepFormer (không skip whisper/pyannote), ghi warning `sepformer_skipped_low_resources`, segment liên quan `manualReviewRequired=true`. Python `psutil` (nếu dùng) chỉ diagnostic, không quyết định skip.
- test requirement: Unit test `resource-guard.spec.ts` — mock RAM thấp, assert SepFormer bị skip và quyết định đến từ phía Node.

#### T-DATA-001 — Chuẩn bị audio test 2-5 phút cho local development

- dependsOn: Không có
- files: `workers/ai-transcription/tests/fixtures/sample-no-overlap.wav` (mới, giả lập), `workers/ai-transcription/tests/fixtures/sample-overlap.wav` (mới, giả lập)
- acceptance criteria: 2 file audio mẫu 2-5 phút — 1 file không overlap, 1 file có ít nhất 1 đoạn overlapped speech; audio giả lập/dựng sẵn, KHÔNG dùng recording thật của công ty; không commit audio/transcript thật vào Git.
- test requirement: Không phải test code — fixture dùng làm input cho T033, T034, T035A; verify bằng review `.gitignore`/quy ước repo.

#### T-BENCH-001 — Benchmark RAM/thời gian xử lý trên máy local để tinh chỉnh threshold 🟡 PARTIAL DONE (2026-07-01)

- dependsOn: T-DATA-001, T014, T016 (cần pipeline chạy được tối thiểu 1 lần để đo)
- files: ghi chú benchmark vào `quickstart.md` hoặc tài liệu vận hành (không phải file code); cập nhật giá trị `AI_WORKER_MIN_FREE_RAM_MB` trong `.env.example`
- acceptance criteria: Có bảng số đo thật (RAM peak, thời gian xử lý) cho tối thiểu 3 tổ hợp (`small+cpu+int8` không SepFormer, `medium+cpu+int8` không SepFormer, `small+cpu+int8` + SepFormer trên overlap ngắn); `AI_WORKER_MIN_FREE_RAM_MB` được cập nhật theo số đo thật, không còn là giá trị đoán (2048MB).
- test requirement: Không phải unit test — là hoạt động đo đạc thủ công; kết quả dùng để cập nhật assertion ngưỡng trong `resource-guard.spec.ts` (T002E) nếu cần.
- **Ghi chú thực thi (2026-07-01)**: đã đo 3 tổ hợp NHƯNG tổ hợp thứ 3 trong plan gốc (`+SepFormer`) KHÔNG đo được vì SepFormer (M3) chưa implement — thay bằng `medium+diarization` (M2, path nặng nhất hiện có). Số đo: small-stt 836MB/24s, medium-stt 1756MB/70s, medium-diar 2583MB/155s. `AI_WORKER_MIN_FREE_RAM_MB` đã cập nhật 2048→4096 (số đo thật, không còn đoán). Coi là PARTIAL: phần SepFormer chờ M3.

### Phase 1 — API + DB integration

#### T003 — Tạo/hoàn thiện TranscriptEntity mapping

- dependsOn: T002
- files: `src/modules/transcription/entities/transcript.entity.ts` (đã tồn tại, chỉ verify — không cần sửa vì đã đủ cột)
- acceptance criteria: Entity build pass; không dùng `synchronize: true`; không tạo migration (không có schema change).
- test requirement: Compile/build check (`npm run build`), không cần spec test riêng cho entity thuần.

#### T004 — Tạo DTO cho transcription job

- dependsOn: T003
- files: `src/modules/transcription/dto/create-transcription-job.dto.ts` (mới)
- acceptance criteria: `CreateTranscriptionJobDto` có `recordingSessionId` (UUID, required), `language` (default `vi-VN`), `speakerMappingMode` (`channel_zone`|`diarization_only`), `forceRerun` (default `false`); class-validator đầy đủ.
- test requirement: Unit test `create-transcription-job.dto.spec.ts` — validate UUID, default value, reject field lạ.

#### T-PERM-001 — Seed permission `transcript.create`/`transcript.read`/`transcript.update`

- dependsOn: T003
- files: `src/database/seeds/<timestamp>-SeedTranscriptionPermissions.ts` (mới — theo đúng pattern đã có ở `src/database/seeds/20260615000009-SeedMediaFilesPermissions.ts`: insert vào `permissions` với `ON CONFLICT (permission_code) DO NOTHING`, grant vào `role_permissions` cho các role tương ứng)
- acceptance criteria: **Gap thực tế đã xác nhận qua `grep` codebase — chưa có seed nào cho 3 permission này, dù đã được dùng trong `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-125/126/127.** Không seed thì mọi RBAC guard `@RequirePermissions('transcript.create'|'read'|'update')` sẽ luôn fail cho mọi user — block toàn bộ M1. Phải seed `transcript.create`, `transcript.read`, `transcript.update` vào `permissions`, grant cho role tương ứng `INTERNAL_USER`/`MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN` (đúng cột "System Role" trong UC-125/126/127) — đây là permission NODE, không thay thế business rule Host/Admin-only ở FR-034/036/038 trong `spec.md`.
- test requirement: Integration test xác nhận role có permission gọi API thành công, role không có permission bị `403`. **Phải làm task này trước T005**, vì T005 sẽ không pass test authorization nếu permission chưa tồn tại trong DB.

#### T005 — Implement POST transcription job API

- dependsOn: T004, T-PERM-001, T-STORAGE-001 (cần xác định media file qua storage), T008 (enqueue — có thể stub trước, wiring đầy đủ sau T008)
- files: `src/modules/transcription/transcription.controller.ts` (mới), `src/modules/transcription/transcription.service.ts` (mới), `src/modules/transcription/constants/transcription-error-codes.ts` (mới — `MEETING_NOT_FOUND`, `RECORDING_SESSION_NOT_FOUND`, `SOURCE_MEDIA_NOT_FOUND`, `TRANSCRIPTION_JOB_ALREADY_RUNNING`, `TRANSCRIPTION_DISABLED`)
- acceptance criteria: Validate JWT, permission `transcript.create`, meeting tồn tại, recording session thuộc meeting, source media file hợp lệ; chặn duplicate khi đang `processing` và `forceRerun=false` (`409 TRANSCRIPTION_JOB_ALREADY_RUNNING`); tạo `background_jobs` + `transcripts` (`processing`); enqueue BullMQ; trả `202`. Error code đúng theo `spec.md` mục 6 (`MEETING_NOT_FOUND`, `RECORDING_SESSION_NOT_FOUND`, `SOURCE_MEDIA_NOT_FOUND`, `TRANSCRIPTION_JOB_ALREADY_RUNNING`, `TRANSCRIPTION_DISABLED`).
- test requirement: Unit test `transcription.service.spec.ts` (5 case theo `spec.md` AC-001/003/004/006); e2e test `test/transcription-job.e2e-spec.ts`.

#### T006 — Implement GET transcript API

- dependsOn: T003
- files: `src/modules/transcription/transcription.controller.ts` (sửa), `src/modules/transcription/transcription.service.ts` (sửa), `src/modules/transcription/dto/query-transcript.dto.ts` (mới — validate `includeSegments`/`page`/`limit`), `src/modules/transcription/dto/transcription-response.dto.ts` (mới — shape response theo `contracts/transcription-api.md`)
- acceptance criteria: Trả transcript mới nhất theo `version_no`; `includeSegments=false` không trả full segment JSON; `includeSegments=true` hỗ trợ pagination; permission `transcript.read`; chỉ Host/participant hợp lệ/Admin được xem; không leak transcript meeting khác (`spec.md` FR-036).
- test requirement: Unit test service + e2e test cho case Host xem được, participant hợp lệ xem được, user ngoài meeting bị từ chối.

#### T007 — Implement background job status mapping ✅ DONE (2026-06-30)

- dependsOn: T005
- files: Tái sử dụng endpoint `background_jobs` hiện có (`src/modules/administration/`) nếu đã đủ; chỉ thêm field mapping nếu thiếu trong response hiện tại.
- acceptance criteria: User gọi tạo job nhận `jobId`; có thể query status `queued`/`running`/`completed`/`failed` qua endpoint background job hiện có, không tạo route trùng lặp.
- test requirement: E2E test xác nhận polling status hoạt động đúng qua endpoint hiện có.
- **Ghi chú thực thi (2026-06-30)**: giả định "endpoint hiện có" của task này là SAI — endpoint `GET /api/v1/background-jobs/:id` chưa từng tồn tại (chỉ có `BackgroundJobsService`, không có controller). Đã tạo controller mới (không phải route trùng lặp — là route chuẩn theo CLAUDE.md mục 22.13 mà chưa ai implement). Chi tiết + authz + verify: xem changelog đầu file (mục T007). Acceptance criteria đạt qua 7 unit test runnable; e2e theo pattern repo (DB-gated).

### Phase 2 — BullMQ worker orchestration

#### T008 — Tạo BullMQ processor cho transcription queue

- dependsOn: T005
- files: `src/modules/transcription/transcription-worker.processor.ts` (mới — `@Processor('transcription')`, theo đúng pattern `MeetingWarningProcessor` đã có trong `src/modules/live-meeting/processors/`)
- acceptance criteria: Job được consume thành công; dùng `jobId = transcription:{backgroundJobId}` chống duplicate; retry policy rõ (2-3 lần cho lỗi tạm thời MinIO/IO, không retry cho lỗi validation như source file missing); failed job cập nhật DB đầy đủ.
- test requirement: Unit test `transcription-worker.processor.spec.ts` (mock `Job`, assert retry/no-retry theo loại lỗi).

#### T009 — Implement job lifecycle update

- dependsOn: T008
- files: `src/modules/transcription/transcription-worker.processor.ts` (sửa), `src/modules/transcription/transcription.service.ts` (sửa)
- acceptance criteria: Worker bắt đầu → `background_jobs.status=running`/`transcripts.status=processing`; thành công → `completed`/`draft`; lỗi → `failed`/`failed`, lưu error code/message ngắn; không có job treo `processing`/`running` vô thời hạn nếu worker crash (cleanup/recovery nếu project đã có scheduler).
- test requirement: Integration test BullMQ lifecycle (xem T032).

### Phase 3 — MinIO private media access

#### T-STORAGE-001 — Cài và implement S3/MinIO-compatible storage adapter

- dependsOn: Không có (infra, nên làm sớm trong M1)
- files: `package.json` (sửa — thêm dependency `minio`), `src/modules/storage/storage.service.ts` (sửa — thêm driver MinIO/S3, hiện chỉ có driver `local`), `src/modules/storage/storage.module.ts` (sửa nếu cần provider mới)
- acceptance criteria: `StorageService` upload/download được file thật với MinIO container local; sinh signed URL có thời hạn ngắn cho client có quyền xem; không tạo public URL cho private bucket; đọc credentials từ env, không hard-code.
- test requirement: Unit test `storage.service.spec.ts` (đã tồn tại file spec — mở rộng case cho driver MinIO) với MinIO container test/mocked client.

#### T010 — Implement internal MinIO audio loader

- dependsOn: T-STORAGE-001, T009
- files: `workers/ai-transcription/src/minio-audio-loader.ts` (mới)
- acceptance criteria: Worker tải file từ `media_files.storage_bucket` + `storage_key`; không dùng public URL, không tạo signed URL cho worker; validate checksum nếu có; file không tồn tại → job failed với error rõ; không log access key/secret.
- test requirement: Unit test `minio-audio-loader.spec.ts` (mock MinIO client) — case file tồn tại, case file thiếu.

#### T011 — Implement temp file lifecycle

- dependsOn: T010
- files: `workers/ai-transcription/src/transcription-job-runner.ts` (mới)
- acceptance criteria: Lưu file tạm trong `AI_WORKER_TEMP_DIR`, mỗi job có thư mục riêng; cleanup sau success/failure; startup cleanup cho temp dir cũ quá TTL nếu worker crash trước đó.
- test requirement: Unit test `transcription-job-runner.spec.ts` — assert cleanup được gọi sau cả 2 nhánh success/failure.

### Phase 4 — Python audio preprocessing

#### T012 — Implement ffmpeg audio normalization

- dependsOn: T011
- files: `workers/ai-transcription/python/audio_preprocess.py` (mới)
- acceptance criteria: Convert `.wav/.mp3/.m4a/.mp4` sang WAV 16kHz; extract audio nếu input là video; giữ metadata channel nếu cần `channel_zone` mapping; lỗi format trả `UNSUPPORTED_MEDIA_FORMAT`.
- test requirement: Pytest cho `audio_preprocess.py` dùng fixture từ T-DATA-001 + 1 file format không hỗ trợ.

#### T013 — Tạo Python result schema

- dependsOn: T012
- files: `workers/ai-transcription/python/schemas.py` (mới); `src/modules/transcription/types/transcript-segment.type.ts` (mới — mirror TypeScript của schema cho `transcription.service.ts`/`transcript-result-writer.ts` dùng khi parse/trả response); tham chiếu `contracts/ai-worker-result-schema.json` (đã có ở bước documentation này)
- acceptance criteria: Python pipeline xuất JSON đúng schema (`languageCode`, `rawText`, `cleanedText`, `confidenceScore`, `segments[]`, `detectedSpeakers[]`, `modelVersions{}`, `warnings[]`); type TypeScript phía Node khớp 1:1 với schema; Node worker parse được; validate schema trước khi ghi DB; JSON invalid → job failed an toàn.
- test requirement: Test schema validation cả 2 phía (Python tự validate trước khi in JSON; Node validate lại trước khi ghi DB) — `schemas.spec.ts`/`schemas_test.py`.

### Phase 5 — faster-whisper STT

#### T014 — Implement faster-whisper runner

- dependsOn: T002A, T013
- files: `workers/ai-transcription/python/whisper_runner.py` (mới)
- acceptance criteria: Load model từ path theo `WHISPER_MODEL` đang active (không hard-code `large-v3`); đọc `WHISPER_DEVICE`/`WHISPER_COMPUTE_TYPE` từ config; `local_files_only`, không network call; chạy được trên cả 2 profile (local: `small`/`medium`+cpu+int8+audio 2-5 phút; production-gpu: `large-v3`+cuda+float16); output segment có `startMs`/`endMs`/`text`/`confidence`.
- test requirement: Smoke test T033 (audio không overlap); unit test `whisper_runner` cho timestamp alignment.

#### T014B — So sánh chất lượng small/medium/large-v3 trên cùng audio tiếng Việt (benchmark, không phải dev hằng ngày)

- dependsOn: T014, T002A (profile `local-quality-test`)
- files: Không tạo code mới — chạy `transcribe_pipeline.py` 3 lần (đổi `--model`) trên cùng 1 file audio cố định; kết quả ghi vào `quickstart.md`/tài liệu vận hành (không phải file code), tương tự cách T-BENCH-001 ghi benchmark RAM/thời gian.
- acceptance criteria: Dùng cùng 1 audio test có từ vựng domain (tên riêng, thuật ngữ ngành — vd "Vietcetera", "podcast", "marketing", "design", "creative", "business") chạy lần lượt qua `small`, `medium`, `large-v3` (profile `local-quality-test`, cap `MAX_AUDIO_DURATION_LOCAL_SECONDS=180`, tắt diarization/overlap/separation để không nhiễu kết quả benchmark STT thuần). Ghi lại: `confidenceScore` trung bình, số segment `lowConfidence=true`, mức độ nhận đúng các proper noun domain kể trên, thời gian xử lý mỗi model. `large-v3` **chỉ dùng để test 1 lần kiểm tra kỳ vọng chất lượng** — sau khi có kết quả, quay lại `medium` (hoặc `small` nếu đủ) cho dev hằng ngày để giữ hiệu năng, đúng quyết định đã chốt.
- test requirement: Không phải unit test — là hoạt động benchmark thủ công/bán tự động (script so sánh), kết quả dùng để quyết định model mặc định cuối cùng cho `local`/`production-cpu-fallback`, không tự động hoá thành CI test.

#### T015 — Chunking strategy cho audio dài

- dependsOn: T014
- files: `workers/ai-transcription/python/transcribe_pipeline.py` (mới — orchestrator gọi `whisper_runner`)
- acceptance criteria: Audio dài chia chunk 5-10 phút, overlap nhỏ 1-2 giây giữa chunk; merge output theo timestamp global; audio 30-90 phút không làm worker crash (chủ yếu áp dụng ở production, vì local giới hạn 2-5 phút).
- test requirement: Unit test merge logic với chunk giả lập (mock timestamps), không cần audio thật dài để test logic merge.

---

## Milestone M2 — Diarization + Overlap Detection

**Goal**: Thêm speaker label + đánh dấu overlap vào transcript đã có từ M1.

**Independent Test**: Chạy lại pipeline trên audio mẫu có overlap (T-DATA-001); xác nhận `detected_speakers_json` có ít nhất 2 speaker và segment overlap được đánh dấu `overlap=true`.

#### T-HF-001 — Xin quyền HuggingFace gated model cho pyannote và preload trước khi build image

- dependsOn: Không có (nên hoàn thành trước khi bắt đầu T016 — có thể làm song song M1)
- files: Không phải code — là quy trình build/preload (ghi chú vào `workers/ai-transcription/Dockerfile` comment + `quickstart.md`); model weights tải về `models/pyannote/`
- acceptance criteria: Một assignee cụ thể (AI Worker/DevOps) dùng máy có internet accept license cho `pyannote/speaker-diarization-3.1` và `pyannote/segmentation-3.0`, tạo access token **READ**, preload model vào volume/image; token KHÔNG có trong runtime container, KHÔNG commit vào Git; ghi chú rõ ai đã accept, ngày accept, version model.
- test requirement: Kiểm chứng gián tiếp qua T035 (security test — container không có token/secret nào sót lại) và T026 (model preload validation).

#### T016 — Implement pyannote diarization runner

- dependsOn: T-HF-001, T015
- files: `workers/ai-transcription/python/diarization_runner.py` (mới)
- acceptance criteria: Load model từ `PYANNOTE_MODEL_PATH`; chạy diarization offline (`PYANNOTE_LOCAL_FILES_ONLY=true`); output speaker turns (`startMs`/`endMs`/`speakerLabel`/`confidence`); không tải model từ internet; nếu diarization fail, STT vẫn hoàn thành với `speakerLabel="unknown"` + warning; chạy được trên local CPU (chấp nhận chậm, không đánh giá performance ở local).
- test requirement: Smoke test T033/T034; unit test `diarization_runner` cho case fail → fallback unknown.

#### T017 — Implement overlap detection

- dependsOn: T016
- files: `workers/ai-transcription/python/overlap_detector.py` (mới)
- acceptance criteria: Dùng output pyannote để detect vùng nhiều speaker cùng lúc; segment trong vùng overlap có `overlap=true`; không overlap thì không gọi SepFormer.
- test requirement: Unit test `overlap_detector` với input diarization turns giả lập (có/không overlap).

#### T018 — Align STT segments với diarization

- dependsOn: T016, T017
- files: `workers/ai-transcription/python/merge_segments.py` (mới)
- acceptance criteria: Mỗi STT segment tìm speaker turn overlap lớn nhất; gán speaker nếu đạt `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO` + `SPEAKER_ASSIGN_MIN_CONFIDENCE`; không đạt thì `unknown`. Segment không overlap có speaker hợp lý; segment mơ hồ không bị ép speaker.
- test requirement: Unit test T031 — 4 case bắt buộc: 1 speaker rõ, 2 speaker gần nhau (không overlap), overlap, không có kết quả diarization.

---

## Milestone M3 — SepFormer best-effort (optional, có thể cắt nếu hết thời gian)

**Goal**: Tách overlap segment best-effort. **Có thể bỏ hoàn toàn milestone này** nếu hết thời gian capstone — pipeline M1+M2 vẫn hoàn chỉnh, overlap segment không tách được sẽ giữ `unknown`/`manualReviewRequired=true`.

**Independent Test**: Với audio có overlap (T-DATA-001), `SEPARATION_ENABLED=true` → segment overlap có `separationConfidence` và có thể có `speakerLabel` cụ thể nếu tách tốt; `SEPARATION_ENABLED=false` → không gọi SepFormer, hành vi giống M2 thuần.

#### T019 — Implement SepFormer runner optional

- dependsOn: T017, T002E
- files: `workers/ai-transcription/python/sepformer_runner.py` (mới)
- acceptance criteria: Chỉ chạy khi overlap detection phát hiện overlapped speech VÀ `SEPARATION_ENABLED=true`; load model từ `SEPFORMER_MODEL_PATH`; không overlap thì không gọi; SepFormer lỗi không fail toàn bộ pipeline, chỉ đánh dấu segment cần review. Ở local: giới hạn overlap segment ngắn (<10s) khi bật để test; có thể bị T002E tự skip khi thiếu RAM — đây là hành vi mong đợi.
- test requirement: T034 (overlap smoke test) — case SepFormer lỗi không crash pipeline.

#### T020 — Process separated overlap audio

- dependsOn: T019
- files: `workers/ai-transcription/python/sepformer_runner.py` (sửa), `workers/ai-transcription/python/merge_segments.py` (sửa)
- acceptance criteria: Cắt audio overlap + buffer nhỏ, chạy SepFormer, chạy faster-whisper trên separated stream nếu đạt `SEPARATION_ACCEPT_MIN_CONFIDENCE`, merge vào segment output; nếu separation tốt → subsegment có speaker/confidence; nếu không tốt → `speakerLabel="unknown"`, `lowConfidence=true`, `manualReviewRequired=true`, warning `overlap_separation_low_confidence`.
- test requirement: T034 — case separation tốt và case separation kém, assert đúng nhánh xử lý.

---

## Milestone M4 — Hoàn thiện (persistence, security, testing, docs)

**Goal**: Hoàn thiện JSON transcript cuối cùng, hardening bảo mật, notification, test đầy đủ, tài liệu vận hành. Phần lớn task này nên làm **đan xen song song** với M1-M3 ngay khi phần tương ứng xong (ví dụ T024/T025/T027 không phụ thuộc M2/M3).

### Phase 8 — Transcript persistence

#### T021 — Build final transcript JSON

- dependsOn: T018, T020 (nếu M3 được làm; nếu M3 bị cắt thì chỉ phụ thuộc T018)
- files: `workers/ai-transcription/python/merge_segments.py` (sửa), `workers/ai-transcription/src/transcript-result-writer.ts` (mới)
- acceptance criteria: `speaker_segments_json` lưu đúng format thống nhất (theo `contracts/ai-worker-result-schema.json`); không vượt response size khi GET không include segments.
- test requirement: Integration test T032.

#### T022 — Build detected speakers JSON

- dependsOn: T021
- files: `workers/ai-transcription/python/merge_segments.py` (sửa)
- acceptance criteria: `detected_speakers_json` đúng cấu trúc (`speakerLabel`, `totalSpeakingMs`, `segmentCount`, `mappedUserId`, `mappingSource`, `confidence`); UI/Host có thể xem danh sách speaker phát hiện; chưa cần tự map user nếu chưa đủ dữ liệu.
- test requirement: Integration test T032.

#### T023 — Update transcript final status

- dependsOn: T021, T022
- files: `workers/ai-transcription/src/transcript-result-writer.ts` (sửa), `src/modules/transcription/transcription.service.ts` (sửa)
- acceptance criteria: Pipeline thành công → `status=draft` (kể cả khi nhiều segment low-confidence, chỉ thêm warning, không đổi status khác); pipeline lỗi nghiêm trọng → `status=failed`; **không bao giờ tự set `reviewed`/`approved`** (đúng `spec.md` FR-042, AC-011).
- test requirement: Integration test T032 + assert AC-011.

#### T-EDIT-001 — Implement PATCH transcript segments API (UC-127) ✅ DONE (2026-07-01)

- **Thực thi (2026-07-01)**: dùng controller RIÊNG `transcript-segments.controller.ts` (`@Controller('transcripts')`) thay vì thêm vào `transcription.controller.ts` (base path `meetings/:meetingId` khác với contract). `revisionNo` lưu trong `speaker_segments_json.editRevisionNo` (KHÔNG thêm cột — tránh migration). Authz Host/Admin, 404 SEGMENT_NOT_FOUND (all-or-nothing), không đổi status. 5 service test + 6 DTO test. (E2e HTTP đầy đủ chờ JWT helper như 1.1.)
- dependsOn: T-PERM-001, T023
- files: `src/modules/transcription/transcription.controller.ts` (sửa — thêm `PATCH /api/v1/transcripts/:transcriptId/segments`), `src/modules/transcription/transcription.service.ts` (sửa), `src/modules/transcription/dto/update-transcript-segments.dto.ts` (mới)
- acceptance criteria: **Gap đã xác nhận: `spec.md` (FR-037, FR-038) và `contracts/transcription-api.md` (UC-127) đã định nghĩa đầy đủ endpoint và authorization cho `transcript.update`, nhưng `docs/Offline Meeting Transcription Pipeline Plan.md` gốc (T001-T038) chưa từng có task implement nó — task này bù lại chỗ thiếu đó.** Cho phép Host/Organizer/Business Admin/System Admin sửa `text`/`speakerLabel`/`speakerUserId` của segment theo `segmentId`; tăng `revisionNo`; ghi `edited_by`/`edited_at`; **không** tự đổi `transcripts.status` sang `reviewed`/`approved` (vẫn giữ nguyên status hiện tại — đúng nguyên tắc draft-không-tự-approve); participant thường bị từ chối (`403 PERMISSION_DENIED`).
- test requirement: Unit test service (Host sửa được, participant bị từ chối, segmentId không tồn tại → `404 SEGMENT_NOT_FOUND`); e2e test theo `contracts/transcription-api.md` UC-127.
- **Ghi chú milestone**: Task này KHÔNG nằm trong M1 Independent Test (M1 chỉ cần create + read). Đặt ở M4 vì là tính năng review/edit, không phải lõi STT — nhưng phải làm trước khi coi toàn bộ authorization model trong `spec.md` là "hoàn thành 100%".

### Phase 9 — Security hardening

#### T024 — Enforce no external STT/API provider ✅ DONE (2026-07-01)

- dependsOn: Không có (làm sớm, song song M1)
- files: `workers/ai-transcription/src/profile-config.ts` (sửa — validate `TRANSCRIPTION_PROVIDER` chỉ chấp nhận `local_faster_whisper`)
- acceptance criteria: Không có code path gọi Google STT/OpenAI/Azure/AssemblyAI/cloud STT khác; nếu config provider khác `local_faster_whisper`, app fail startup.
- test requirement: Config test verify provider chỉ local; code search (`grep`) không có external STT call — ghi vào checklist `T035`.
- **Thực thi (2026-07-01)**: `assertLocalProviderOnly()` đã có + được gọi trong `runTranscriptionJob`; test `profile-config.spec.ts`. Code-search codify hoá thành test tự động `python/no_external_stt_test.py` (scan không có lib cloud STT/egress) — chống regression, không chỉ grep tay 1 lần.

#### T025 — Enforce AI worker no outbound internet 🟢 PARTIAL (2026-07-01)

- dependsOn: Không có (infra, làm sớm)
- files: `docker-compose.dev.yml` / `docker-compose.staging.yml` (sửa — network internal, không publish public port cho AI worker)
- acceptance criteria: AI worker không publish public port; nằm trong private/internal network; chỉ kết nối Redis/PostgreSQL (nếu cần)/MinIO/internal backend service; chặn outbound internet bằng Docker network/firewall/security group, không chỉ dựa vào code.
- test requirement: T035 (security test thực tế — exec container, thử curl ra ngoài phải fail, thử MinIO internal phải pass).
- **Thực thi (2026-07-01)**: Code-level enforced + verify-được-ngay (no egress lib, `HF_HUB_OFFLINE=1`, `PYANNOTE_LOCAL_FILES_ONLY` guard — `python/no_external_stt_test.py`). **Chênh lệch kiến trúc thật**: AI worker = subprocess backend, không container riêng → cô lập mạng áp ở container backend (chưa dockerize). Ghi chú triển khai network-isolation vào `docker-compose.dev.yml` + quy trình verify vào `quickstart.md`. Phần curl-từ-container CHƯA chạy được (chờ containerize) — PARTIAL.

#### T026 — Model preload validation ✅ DONE (2026-07-01)

- dependsOn: T-HF-001, T014, T016, T019 (validate đúng model đang cần theo profile)
- files: `workers/ai-transcription/src/profile-config.ts` (sửa — startup healthcheck)
- acceptance criteria: Startup validate model path tồn tại theo `WHISPER_MODEL` đang active, `pyannote`, `SpeechBrain SepFormer` nếu enabled; thiếu model → fail fast, error rõ; không network download; log chỉ ghi thiếu path/model, không ghi secret; healthcheck unhealthy nếu model missing.
- test requirement: Unit test `profile-config.spec.ts` — mock thiếu model path.
- **Thực thi (2026-07-01)**: tách thành module riêng `src/model-validation.ts` (`validateModelsAvailable`) thay vì nhét vào profile-config — gọi trong `runTranscriptionJob` TRƯỚC khi tải audio/spawn Python (fail-fast). Validate whisper path (nếu set), pyannote config.yaml (khi diarization on), sepformer (khi separation on). Lỗi `*_NOT_PRELOADED` thêm vào `isNonRetryableError` (không retry lỗi cấu hình). 9 test `model-validation.spec.ts` (gồm assert không log secret).

#### T027 — Sensitive logging policy ✅ DONE (2026-07-01)

- dependsOn: T002D
- files: Toàn bộ file log trong `workers/ai-transcription/src/` và `src/modules/transcription/`
- acceptance criteria: Không log raw transcript full, audio path public, MinIO secret, JWT/service token; log chỉ có `jobId`, `meetingId`, `recordingSessionId`, `status`, `duration`, `error code`.
- test requirement: Test assertion trên log output (snapshot/regex) đảm bảo không có pattern nhạy cảm.
- **Thực thi (2026-07-01)**: audit toàn bộ log — đã sạch (không secret/token/raw-transcript). Thêm `src/logging-policy.spec.ts` (3 test) capture `console.error` + assert không lọt secret env / không field nhạy cảm. (`minio-audio-loader.spec.ts` đã có sẵn 1 assert không log access/secret key.)

### Phase 10 — Notification & manual review support

#### T028 — Mark manual review required ✅ DONE (2026-07-01)

- **Thực thi (2026-07-01)**: làm ở `transcription.service.updateTranscriptResult` (backend) — tính `manualReviewRequired`/`manualReviewSegmentCount` từ segment low-confidence, lưu vào `speaker_segments_json`. KHÔNG có `transcript-result-writer.ts` (result-writing ở backend service, không phải Node worker). 1 test.
- dependsOn: T020, T023
- files: `workers/ai-transcription/python/merge_segments.py` (sửa), `workers/ai-transcription/src/transcript-result-writer.ts` (sửa)
- acceptance criteria: Transcript có nhiều low-confidence segment → đánh dấu trong JSON (`detected_speakers_json`/metadata); UI có thể nhận biết cần review; không thêm bảng/workflow review mới trong MVP.
- test requirement: Integration test T032.

#### T029 — Optional notification after transcript completed ✅ DONE (2026-07-01)

- **Thực thi (2026-07-01)**: `notifyTranscriptReady()` gọi từ processor sau `markCompleted`; in-app cho Host qua `NotificationsService.createNotification` (type `TRANSCRIPT_READY`); fail-safe (try/catch, notification lỗi không fail job). 3 service test (tạo được / throw không lan ra / không Host thì bỏ qua) + 1 processor test.
- dependsOn: T023
- files: `src/modules/transcription/transcription.service.ts` (sửa — gọi `NotificationsService`/event)
- acceptance criteria: Transcript `draft` xong → gửi in-app notification cho Host nếu `NotificationsService` sẵn; đi qua `NotificationsService`/BullMQ, không tự insert notification bằng tay; notification fail không làm fail transcription.
- test requirement: Integration test mock `NotificationsService`, assert transcription vẫn `completed` khi notification throw lỗi.

### Phase 11 — Testing

#### T030 — Unit test service tạo transcription job

- dependsOn: T005
- files: `src/modules/transcription/transcription.service.spec.ts`
- acceptance criteria/test requirement: Test case — meeting không tồn tại, recording session không thuộc meeting, không có source media file, có job đang processing + `forceRerun=false`, tạo job thành công; error code đúng theo `spec.md` mục 6.

#### T031 — Unit test speaker assignment logic

- dependsOn: T018
- files: Test cho `merge_segments.py` (pytest) hoặc test TypeScript tương đương nếu logic này nằm ở Node
- acceptance criteria/test requirement: Test case — 1 speaker rõ ràng, segment giữa 2 speaker không overlap, segment overlap 2 speaker, diarization missing, confidence thấp; low confidence luôn ra `unknown`; không có case ép gán speaker sai.

#### T032 — Integration test BullMQ job lifecycle

- dependsOn: T008, T009, T021, T022, T023
- files: `test/transcription-job-lifecycle.e2e-spec.ts` (mới)
- acceptance criteria/test requirement: Flow — tạo background job → enqueue BullMQ → worker consume → mock Python result → update transcript → mark job completed. Assert: job completed, transcript `status=draft`, JSON segments lưu đúng.

#### T033 — AI pipeline smoke test với sample audio

- dependsOn: T014, T016 (nếu M2 đã làm; tối thiểu cần T014), T-DATA-001
- files: `workers/ai-transcription/tests/smoke-no-overlap.spec.ts` hoặc `pytest` tương đương
- acceptance criteria/test requirement: Audio mẫu 30-60s (T-DATA-001) chạy offline có transcript text + diarization output (nếu M2 sẵn); không cần SepFormer nếu không có overlap; output JSON valid theo `contracts/ai-worker-result-schema.json`.

#### T034 — Overlap smoke test

- dependsOn: T016, T019, T020, T-DATA-001
- files: `workers/ai-transcription/tests/smoke-overlap.spec.ts`
- acceptance criteria/test requirement: Audio mẫu có 2 người nói chồng; pyannote detect overlap; SepFormer được gọi; nếu separation không chắc, segment bị mark manual review; best-effort behavior đúng, không crash pipeline khi SepFormer fail.

#### T035 — Security test no internet

- dependsOn: T025
- files: Checklist/script kiểm chứng trong `quickstart.md` (không phải unit test code)
- acceptance criteria/test requirement: Exec vào AI worker container, thử gọi public internet → phải fail; thử truy cập MinIO internal → phải pass. Có bằng chứng test trong quickstart hoặc checklist.

#### T035A — Test resource guard & profile switching

- dependsOn: T002B, T002C, T002E
- files: `workers/ai-transcription/src/resource-guard.spec.ts`, `workers/ai-transcription/src/profile-config.spec.ts`
- acceptance criteria/test requirement: 3 case — audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject ở local; `production-gpu` thiếu CUDA fail fast; RAM thấp ở local → SepFormer tự skip, `manualReviewRequired=true`. Không job nào treo vô thời hạn.

### Phase 12 — Documentation & demo

#### T036 — Cập nhật feature documentation

- dependsOn: M1 hoàn tất (tối thiểu); M2/M3 nếu đã làm
- files: `spec/features/transcription/feat-offline-local-transcription-pipeline/quickstart.md` (đã tạo ở bước documentation-first này — cập nhật khi implement xong)
- acceptance criteria: Developer mới đọc docs chạy được pipeline local; tài liệu ghi rõ MVP offline-only, không dùng cloud STT/API.
- test requirement: Không cần test code — verify bằng cách 1 dev khác làm theo quickstart và chạy thành công.

#### T037 — Viết quickstart cho agent/dev

- dependsOn: T036
- files: `quickstart.md` (đã tạo — xem file kèm trong cùng thư mục)
- acceptance criteria: Có command mẫu (start Postgres/Redis/MinIO, mount model volume, start backend, start AI worker, chuẩn bị audio, gọi API, check job, get transcript); không chứa secret thật.
- test requirement: Chạy thử toàn bộ quickstart trên máy sạch, xác nhận từng bước hoạt động.

#### T038 — Demo acceptance checklist

- dependsOn: Tất cả task M1 (bắt buộc) + M4 tương ứng; M2/M3 nếu đã làm
- files: Checklist trong `quickstart.md` (mục cuối) — đã phân tách Local vs Production trong `docs/Offline Meeting Transcription Pipeline Plan.md` mục T038 gốc
- acceptance criteria: Checklist chung (MinIO private, 202, background_jobs có đủ row, BullMQ nhận job, AI worker xử lý offline, transcripts có raw/cleaned text + speaker segments, overlap không chắc → unknown/manual review, không outbound internet, không cloud STT call, log thể hiện rõ profile/model/device) **và** checklist riêng Local (audio 2-5 phút thành công bằng `small`/`medium`, duration guard hoạt động, SepFormer off không bị coi thiếu sót) **và** checklist riêng Production (chỉ áp dụng khi `AI_PROFILE=production-gpu` thật được triển khai — future, không phải MVP gate).
- test requirement: Chạy toàn bộ test suite M1 (+M2/M3 nếu có) và xác nhận từng dòng checklist bằng kết quả test thật, không tự suy diễn.

---

## Dependencies & Execution Order

### Milestone Dependencies

- **M1 (bắt buộc)**: Không phụ thuộc milestone khác — bắt đầu ngay sau khi đọc `spec.md`/`plan.md`.
- **M2**: Phụ thuộc M1 chạy end-to-end được ít nhất 1 lần (có transcript text); phụ thuộc cứng `T-HF-001` hoàn thành trước `T016`.
- **M3**: Phụ thuộc M2 (`T017` overlap detection) đã chạy được; **có thể bỏ hoàn toàn** nếu hết thời gian.
- **M4**: Một phần phụ thuộc M1 (T021-T023, T030-T033, T036-T038), một phần độc lập và nên làm sớm/song song (T024, T025, T027 không phụ thuộc M2/M3); T034/T035A phụ thuộc M2/M3.

### Parallel Opportunities

- `T002A`-`T002D` có thể chạy song song sau `T002` (khác file, không phụ thuộc lẫn nhau trừ `T002E` phụ thuộc `T002B`+`T002D`).
- `T-DATA-001` có thể làm song song với toàn bộ Phase 0.5-5 (không phụ thuộc code).
- `T-HF-001` có thể làm song song với toàn bộ M1 (không phụ thuộc code M1, chỉ cần hoàn thành trước `T016`).
- `T024`, `T025`, `T027` có thể làm song song với M1-M3 (cross-cutting, không phụ thuộc business logic).
- `T030`-`T035A` (test) nên viết song song hoặc ngay sau implementation tương ứng, không dồn hết về cuối.

### Implementation Strategy

**MVP First**: Hoàn thành toàn bộ M1 → STOP và validate bằng `T033` (smoke test không overlap) + `T030` (unit test tạo job) + `T032` (integration lifecycle) → demo được "tạo job → có transcript text" trước khi đầu tư vào M2.

**Incremental Delivery**: M1 (demo lõi STT) → M2 (thêm speaker label/overlap, demo nâng cao) → M3 (optional, demo "wow factor" nếu kịp) → M4 đan xen suốt quá trình, không dồn về cuối vì security/testing/docs cần làm sớm để tránh nợ kỹ thuật.
