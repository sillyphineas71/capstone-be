# Thứ tự thực thi tiếp theo — Offline Meeting Transcription Pipeline

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Tạo file roadmap thứ tự công việc, tổng hợp trạng thái thật của M1-M4 sau khi hoàn thành M2 core (T-HF-001/T016-T018) + T007. Chia công việc còn lại thành các "wave" theo thứ tự ưu tiên thực thi an toàn. | Toàn bộ file (mới) |
| 2026-07-01 | Cập nhật trạng thái Wave 1: T033 ✅ (smoke test pipeline thật), T032 ✅ (integration BullMQ+DB lifecycle chạy thật trên Postgres+Redis live), T030 ✅ (đã phủ sẵn). Còn lại Wave 1: 1.1 (HTTP E2E — cần JWT helper) và 1.5 (T-BENCH-001). | Mục 2 (bảng đã xong), Wave 1 |
| 2026-07-01 | **Wave 2 ✅ DONE**: fixture `sample-overlap.wav` (2.1), T031 (2.2), T034 overlap smoke (2.3) — M2 Independent Test chạy thật thành công lần đầu (detectedSpeakers=2 + overlap=true). Kèm fix correctness `merge_segments` (per-speaker aggregation). T-BENCH-001 (1.5) PARTIAL DONE. | Wave 2, M2 status |
| 2026-07-01 | **Wave 3**: T026 ✅ (model preload validation), T027 ✅ (sensitive logging), T024/T035A ✅ (đã có + enforcement test mới), T025/T035 🟢 PARTIAL (code-level offline enforced+verified; container network-isolation documented, chờ dockerize backend). | Wave 3 |
| 2026-07-01 | **Wave 4 ✅ DONE**: T-EDIT-001 (PATCH segments UC-127), T028 (mark manual review), T029 (notification fail-safe), T021-T023 (confirm done). 66 test pass + integration PASS. | Wave 4, M4 status |

---

## 0. Mục đích & cách dùng file này

File này là **bản đồ thứ tự thực thi** cho phần `feat-offline-local-transcription-pipeline`, dùng để:

- Lưu lại một thứ tự ổn định, không phải nhớ lại mỗi session.
- Biết **đang ở đâu**, **làm gì tiếp**, **tại sao theo thứ tự đó**.

Nguồn chuẩn của từng task vẫn là `spec/features/transcription/feat-offline-local-transcription-pipeline/tasks.md` (mô tả chi tiết acceptance criteria + test requirement) và `plan.md`. File này KHÔNG thay thế chúng — chỉ sắp **thứ tự ưu tiên** và ghi **trạng thái thật**.

Quy ước trạng thái:
- ✅ DONE — đã code + verify thật.
- 🟡 PARTIAL — đã làm một phần, còn nợ điều kiện acceptance.
- ⬜ TODO — chưa bắt đầu.
- ⏭️ OPTIONAL — có thể cắt nếu hết thời gian (không phá hoàn chỉnh MVP).

---

## 1. Trạng thái tổng quan theo milestone

| Milestone | Mục tiêu | Trạng thái |
| :--- | :--- | :--- |
| **M1** — Lõi STT | Tạo job → BullMQ → AI Worker → faster-whisper → transcript text | 🟢 GẦN XONG — verify thật qua BullMQ+DB (T032), smoke pipeline (T033), unit (T030). Còn 1.1 (HTTP E2E qua JWT) + T014B(large-v3) |
| **M2** — Diarization + Overlap | Thêm speaker label + overlap vào transcript | ✅ **Independent Test PASS** (2026-07-01) — fixture overlap + T034 chạy thật: detectedSpeakers=2, overlap=true. Kèm fix correctness merge logic (per-speaker aggregation) |
| **M3** — SepFormer | Tách overlap best-effort | ⏭️ OPTIONAL — chưa có code (`sepformer_runner.py` chưa tồn tại) |
| **M4** — Hoàn thiện | Persistence, security, test, docs | 🟢 GẦN XONG — Wave 3 (security) ✅ code-level, Wave 4 (edit/notification) ✅. Còn: T035 container test (chờ dockerize), Wave 6 (docs/demo), T-EDIT e2e |

---

## 2. Đã hoàn thành (không cần làm lại)

| Task | Nội dung | Ghi chú verify |
| :--- | :--- | :--- |
| T001-T006 | Scope lock, DTO, entity, POST tạo job, GET transcript | Unit test pass |
| T002A-T002E | Profile/resource guard config | `profile-config.spec.ts`, `resource-guard.spec.ts` |
| T-PERM-001 | Seed permission `transcript.create/read/update` | Migration có thật |
| T008/T009 | BullMQ processor + job lifecycle | `transcription-worker.processor.spec.ts` |
| T-STORAGE-001/T010/T011 | MinIO adapter + audio loader + temp lifecycle | Unit test pass |
| T012/T013 | ffmpeg normalize + result schema | pytest pass |
| T014/T015 | faster-whisper runner + chunking | verify thật trên audio tiếng Việt |
| **T-HF-001** | License HF + preload pyannote | ✅ verify thật, model trong `models/pyannote/` |
| **T016/T017/T018** | Diarization + overlap + merge | ✅ verify thật `transcribe_pipeline.py --diarization-enabled true` |
| **T007** | `GET /api/v1/background-jobs/:id` | ✅ controller mới + 7 unit test + build pass |

---

## 3. THỨ TỰ THỰC THI TIẾP THEO (các wave)

> Nguyên tắc sắp xếp: **đóng chắc cái đang dở + dựng lưới an toàn (test/infra) TRƯỚC khi mở rộng tính năng mới**. Không dồn security/test về cuối (đúng tinh thần plan mục "Implementation Strategy").

### 🌊 WAVE 1 — Đóng M1 cho "thật" + lưới an toàn (ưu tiên cao nhất)

Lý do đi trước: hiện M1 mới chỉ chạy qua CLI Python + unit test có mock. Chưa có lần nào job đi trọn đường **HTTP → BullMQ → AI Worker subprocess → ghi DB**. Rủi ro lỗi wiring tầng Node còn ẩn. Phải lộ ra sớm.

| # | Task | Việc cụ thể | Trạng thái |
| :-- | :--- | :--- | :--- |
| 1.1 | (mới) Smoke chạy thật E2E qua HTTP | Gọi thật `POST .../transcription-jobs` → poll `GET /background-jobs/:id` → `GET .../transcript` qua HTTP + JWT thật | ⬜ TODO — **cần JWT e2e helper** (repo chưa có, mọi e2e đang để TODO token). T032 đã chứng minh service+worker+DB; 1.1 chỉ còn delta tầng HTTP/JWT |
| 1.2 | **T032** | Integration test BullMQ job lifecycle (`test/transcription-job-lifecycle.e2e-spec.ts`) | ✅ DONE — chạy thật Postgres+Redis live, gate `RUN_INTEGRATION=1`, PASS |
| 1.3 | **T033** | AI pipeline smoke test với `sample-no-overlap.wav` | ✅ DONE — pipeline thật + validate schema, gate `RUN_SMOKE=1`, PASS |
| 1.4 | **T030** | Unit test service tạo job | ✅ DONE — đã phủ sẵn 15 test |
| 1.5 | **T-BENCH-001** | Đo RAM/thời gian thật, cập nhật `AI_WORKER_MIN_FREE_RAM_MB` | 🟡 PARTIAL DONE — đo 3 path (small/medium/medium+diar), threshold 2048→4096. Phần `+SepFormer` chờ M3 |

### 🌊 WAVE 2 — Hoàn tất M2 (thoả Independent Test) — ✅ DONE (2026-07-01)

| # | Task | Việc cụ thể | Trạng thái |
| :-- | :--- | :--- | :--- |
| 2.1 | **T-DATA-001 (phần còn thiếu)** | Tạo fixture `sample-overlap.wav` (≥2 giọng, có đoạn chồng tiếng) | ✅ DONE — 2 giọng vi-VN, timeline A→overlap→B, verify thật |
| 2.2 | **T031** | Unit test speaker assignment (4 case bắt buộc) cho `merge_segments.py` | ✅ DONE — 9 test pass (4 bắt buộc + regression fragmentation) |
| 2.3 | **T034** | Overlap smoke test — chạy pipeline trên fixture overlap | ✅ DONE — `RUN_SMOKE=1`, PASS: detectedSpeakers=2, overlap=true, best-effort không crash |

> **Phát sinh trong Wave 2 — fix correctness thật**: phát hiện `merge_segments._best_matching_turn` (T018) chỉ lấy 1 turn đơn → gán "unknown" oan khi pyannote fragment 1 speaker thành nhiều turn. Đổi sang `_dominant_speaker` cộng dồn overlap theo speaker. 8 test cũ backward-compatible. **Đây là lần đầu M2 Independent Test chạy thật thành công.**

### 🌊 WAVE 3 — M4 Security & Infra (cốt lõi của cả dự án — KHÔNG để cuối)

Lý do đi sớm: "AI worker không outbound internet" + "không cloud STT" là **yêu cầu bảo mật chốt** của dự án. Hiện `docker-compose.dev.yml` **chưa có service AI worker nào**, nên chưa thể test cách ly mạng thật.

| # | Task | Việc cụ thể | Định nghĩa DONE |
| :-- | :--- | :--- | :--- |
| 3.1 | **T025** | AI worker network internal, không publish port public, chặn outbound | 🟢 PARTIAL — code-level enforced+verify (no egress lib, HF_HUB_OFFLINE, guard); infra documented (docker-compose + quickstart). Curl-từ-container chờ dockerize backend |
| 3.2 | **T035** | Security test: curl ra ngoài FAIL, MinIO PASS + xác minh cảnh báo HF | 🟢 PARTIAL — code-level verify-được-ngay (`no_external_stt_test.py`); container curl test + HF warning capture chờ dockerize |
| 3.3 | **T026** | Model preload validation, fail fast | ✅ DONE — `model-validation.ts` + 9 test, wire vào runTranscriptionJob, NOT_PRELOADED non-retryable |
| 3.4 | **T027** | Sensitive logging policy | ✅ DONE — `logging-policy.spec.ts` (3 test) + audit sạch |
| 3.5 | **T035A** | Test resource guard & profile switching | ✅ DONE — resource-guard.spec + profile-config.spec (CUDA fail-fast) |

> **Trung thực về T025/T035**: kiến trúc thật = AI worker chạy như **subprocess của backend** (không container riêng). Enforcement offline nằm ở tầng code và ĐÃ verify (scan no-egress + guard `HF_HUB_OFFLINE`/`PYANNOTE_LOCAL_FILES_ONLY`). Phần cô lập mạng tầng container cần **dockerize backend trước** — chưa làm; đã ghi quy trình verify đầy đủ vào `docker-compose.dev.yml` + `quickstart.md`.

### 🌊 WAVE 4 — M4 Review/Edit + Notification — ✅ DONE (2026-07-01)

| # | Task | Việc cụ thể | Trạng thái |
| :-- | :--- | :--- | :--- |
| 4.1 | **T021/T022/T023** | Build final transcript JSON + detected speakers + final status | ✅ DONE (qua `updateTranscriptResult` — không có `transcript-result-writer.ts` riêng, result-writing ở backend service) |
| 4.2 | **T-EDIT-001** | `PATCH /api/v1/transcripts/:transcriptId/segments` (UC-127) | ✅ DONE — controller+service+DTO, authz Host/Admin, 404 segment, revision++, không đổi status; 11 test |
| 4.3 | **T028** | Mark manual review required | ✅ DONE — transcript-level `manualReviewRequired` trong JSON |
| 4.4 | **T029** | Notification sau khi transcript `draft` xong | ✅ DONE — in-app cho Host, fail-safe, `TRANSCRIPT_READY`; 4 test |

> **Verify Wave 4**: backend build pass, 66 transcription+admin test pass, integration test (T032) vẫn PASS với NotificationsService wiring mới. Response UC-127 đúng contract (`revisionNo`/`updatedSegments`/`editedBy`/`updatedAt`).

### 🌊 WAVE 5 — M3 SepFormer (OPTIONAL — cắt được nếu hết thời gian)

| # | Task | Việc cụ thể |
| :-- | :--- | :--- |
| 5.1 | **T019** | `sepformer_runner.py` — chỉ chạy khi overlap + `SEPARATION_ENABLED=true` |
| 5.2 | **T020** | Process separated overlap audio + merge |

> Nếu cắt M3: pipeline M1+M2 vẫn hoàn chỉnh, overlap segment giữ `unknown`/`manualReviewRequired=true`.

### 🌊 WAVE 6 — Docs, demo, hoàn tất benchmark

| # | Task | Việc cụ thể |
| :-- | :--- | :--- |
| 6.1 | **T014B (phần còn nợ)** | Benchmark `large-v3` trên máy đủ dung lượng đĩa (máy dev hiện thiếu ~3GB) |
| 6.2 | **T036/T037** | Cập nhật `quickstart.md`, chạy thử quickstart trên máy sạch |
| 6.3 | **T038** | Demo acceptance checklist (Local + Production tách riêng) |

---

## 4. Nợ kỹ thuật / follow-up đã ghi nhận (không quên)

| Mục | Mô tả | Theo dõi ở |
| :--- | :--- | :--- |
| `estimatedCompletion` | Response POST tạo job (UC-125 contract) có field này nhưng service chưa trả | Gắn vào Wave 4 (cùng nhóm hoàn thiện response) |
| HF unauthenticated warning | Cảnh báo lạ dù `HF_HUB_OFFLINE=1` — cần network capture xác minh | Wave 3 / T035 |
| `large-v3` benchmark | Chưa chạy được do thiếu dung lượng đĩa | Wave 6 / T014B |
| `torchcodec` không cần | Đã xác nhận không dùng (patch soundfile thay thế) — KHÔNG thêm vào `requirements.txt` | Đã chốt |

---

## 5. Quyết định cần người dùng / team chốt

1. **Có làm M3 (SepFormer) không?** — optional theo plan; ảnh hưởng phạm vi demo "wow factor".
2. **Hạ tầng test thật**: có dựng Postgres+Redis+MinIO local thường trực để chạy integration/e2e không, hay chỉ chạy theo đợt? (ảnh hưởng cách viết Wave 1).
3. **Token e2e**: repo chưa có helper sinh JWT cho e2e (các file e2e đang để TODO token) — có muốn làm helper này một lần để mọi e2e chạy xanh không?

---

## 6. Tóm tắt 1 dòng

> Đang ở cuối M2 (core đã chạy thật). Việc kế tiếp đúng đắn nhất: **Wave 1 — chạy 1 job thật qua HTTP+BullMQ + viết integration/smoke test**, để có lưới an toàn trước khi mở rộng sang security infra (Wave 3) và các tính năng M4 còn lại.
