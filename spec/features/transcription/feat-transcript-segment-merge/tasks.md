## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo tasks.md ban đầu, tách từ `spec.md`/`plan.md` mục 4-5. | Toàn bộ file (mới) |
| 2026-08-02 | **P2 implement**: T-MERGE-001✅ (`whisper_runner.py` + `VadOptions`, mặc định 2000ms giữ nguyên khi không set env, đọc `WHISPER_VAD_MIN_SILENCE_MS` khi có — 3 test mới `whisper_runner_test.py`). T-MERGE-002✅ (`merge_fragmented_segments()` + `_merge_two_segments()` trong `merge_segments.py`, tái dùng `_dominant_speaker()`). T-MERGE-003✅ (chèn vào `transcribe_pipeline.py` trong nhánh `if turns:`, trước `assign_speakers()`, có `log_event("segment_merge_done", ...)`) — verify bằng chạy lại `transcribe_pipeline_smoke_test.py` + `smoke_overlap_test.py` (RUN_SMOKE=1, cả 2 PASS, 44.67s, không phá luồng cũ). T-MERGE-004✅ (9 test case mới trong `merge_segments_test.py`, bao gồm AC-001→AC-004 + FR-009 + non-mutation + empty-turns passthrough — toàn bộ 59 test Python pass, không có test cũ nào bị sửa/xoá). **T-MERGE-005✅ — BENCHMARK THẬT ĐẠT** trên `04_ClimateDiscussion_10min.mp3` (tạo mới `bench_climate.py`): tổng segment **97 → 70** (giảm 28%), unknown **6 (6.2%) → 4 (5.7%)** (giảm, không tăng), RTF **1.726 → 1.736** (trong ngưỡng ≤1.90), RAM đỉnh **2612.9 → 2614.2 MB** (không đổi đáng kể). Cả 3 gate bắt buộc (NFR-001/NFR-003/NFR-004) PASS. Spot-check thủ công: segment ví dụ trong plan gốc (4 mảnh "Chủ đề của chúng ta là biến đổi khí hậu...") gộp đúng thành 1 câu liền mạch, `detectedSpeakers` vẫn đúng 5/5 người nói, không phát hiện lỗi trộn lời giữa 2 người nói ở bất kỳ segment nào có note `segment_merged_same_turn` (10/70 segment được gộp). **Phát hiện quan trọng**: log `whisper_done segmentCount=97` (bằng đúng mốc gốc) cho thấy VAD tuning (GA-10) KHÔNG đóng góp gì vào giảm mảnh trong lần chạy này — toàn bộ cải thiện 97→70 đến từ bước gộp (GA-11) một mình, vì `WHISPER_VAD_MIN_SILENCE_MS` chưa được set (đang dùng mặc định thư viện 2000ms, đúng ý CLR-001: để benchmark quyết định, chưa cần tinh chỉnh vì đã đạt gate mà không cần đổi). | T-MERGE-001..005, `bench_climate.py` (mới) |

# Tasks: TRANS-SEGMENT-MERGE-001 Transcript Segment Merge

**Input**: Design documents from `spec/features/transcription/feat-transcript-segment-merge/`
**Prerequisites**: `spec.md`, `plan.md`

**Tests**: Bắt buộc — spec.md NFR-005 yêu cầu unit test tối thiểu 4 case, và ERR-GA-001 là ràng buộc an toàn không được bỏ qua verify.

**Không code ở bước này** — tasks.md chỉ mô tả kế hoạch thực thi. Implementation chỉ bắt đầu sau khi Thiếu Chủ duyệt spec/plan/tasks này (theo yêu cầu quy trình đã đặt ra).

## Path Conventions

- AI Worker (Python pipeline): `workers/ai-transcription/python/`

---

## Phase 1 — Xác nhận môi trường & khoá scope

### T-VAD-000 — Xác nhận version faster-whisper và API `vad_parameters` thật đang cài

- dependsOn: Không có
- files: Không tạo file (research, đã hoàn thành trong bước viết plan.md — `faster-whisper==1.2.1`, `VadOptions.min_silence_duration_ms` default `2000`)
- acceptance criteria: Đã xác nhận (xem plan.md mục 4.1) — task này coi như DONE tại thời điểm viết tasks.md, giữ lại để trace nguồn gốc con số.
- test requirement: Không cần.

---

## Phase 2 — GA-10: Tinh chỉnh VAD

### T-MERGE-001 ✅ — Thêm `vad_parameters` tường minh vào `whisper_runner.transcribe()`

- dependsOn: T-VAD-000
- files: `workers/ai-transcription/python/whisper_runner.py` (sửa — thêm import `VadOptions`, đọc `WHISPER_VAD_MIN_SILENCE_MS` từ env, truyền vào `model.transcribe(vad_parameters=...)`)
- acceptance criteria: Khi không set env, hành vi giữ nguyên mặc định thư viện (2000ms) — không phá vỡ test/benchmark cũ nào không liên quan đến feature này; khi set env, giá trị mới có hiệu lực thật (verify bằng cách log giá trị đang dùng, tương tự cách `AI_PROFILE`/`WHISPER_MODEL` đã log ở feature trước).
- test requirement: Unit test nhỏ trong `whisper_runner_test.py` (file mới nếu chưa có, hoặc thêm vào file test hiện có nếu đã tồn tại — kiểm tra trước khi tạo) — mock `WhisperModel.transcribe` và assert `vad_parameters` được truyền đúng giá trị từ env.

---

## Phase 3 — GA-11: Hàm gộp mảnh (an toàn là ưu tiên số 1)

### T-MERGE-002 ✅ — Viết `merge_fragmented_segments()` trong `merge_segments.py`

- dependsOn: Không có (độc lập với Phase 2)
- files: `workers/ai-transcription/python/merge_segments.py` (sửa — thêm hàm mới, tái sử dụng `_dominant_speaker()` đã có, KHÔNG viết lại thuật toán tìm turn chiếm ưu thế)
- acceptance criteria:
  - Gộp đúng khi: cùng turn chiếm ưu thế (theo `_dominant_speaker`) + khoảng cách < ngưỡng cấu hình (env, ví dụ `SEGMENT_MERGE_MAX_GAP_MS`, mặc định đề xuất 800ms theo plan tổng) + segment trước không kết thúc bằng `.`/`!`/`?`.
  - **KHÔNG BAO GIỜ gộp qua 2 turn/speaker khác nhau** — đây là điều kiện phải test riêng, xem T-MERGE-004.
  - Segment không overlap turn nào (`_dominant_speaker` trả None) không được gộp với bất kỳ ai.
  - Segment output vẫn đúng shape `REQUIRED_SEGMENT_FIELDS` (`schemas.py`) — pass được `validate_result()`.
- test requirement: Xem T-MERGE-004 (cùng phase, gộp chung để test viết đồng thời với hàm).

### T-MERGE-003 ✅ — Chèn `merge_fragmented_segments()` vào `transcribe_pipeline.py`

- dependsOn: T-MERGE-002
- files: `workers/ai-transcription/python/transcribe_pipeline.py` (sửa — chèn đúng vị trí đã xác định ở plan.md mục 4.3, trong nhánh `if turns:`, trước `assign_speakers()`)
- acceptance criteria: FR-005/FR-006/FR-007 (spec.md) — merge chạy đúng khi có turns, log `segment_merge_done` với `beforeCount`/`afterCount`, không chạy khi turns rỗng.
- test requirement: Cập nhật/verify lại `transcribe_pipeline_smoke_test.py` và `smoke_overlap_test.py` (đã có sẵn từ feature trước) vẫn PASS sau khi chèn bước mới — không cần viết smoke test mới, chỉ chạy lại (`RUN_SMOKE=1`) để xác nhận không phá vỡ luồng cũ.

### T-MERGE-004 ✅ — Unit test cho hàm gộp mảnh (bắt buộc theo spec NFR-005)

- dependsOn: T-MERGE-002
- files: `workers/ai-transcription/python/merge_segments_test.py` (sửa — thêm test case mới vào file đã có, KHÔNG tạo file test riêng)
- acceptance criteria: Tối thiểu 4 case pass, ánh xạ đúng AC trong spec.md:
  - Case gộp đúng (AC-001).
  - **Case an toàn — không gộp qua 2 speaker khác nhau dù khoảng cách rất gần** (AC-002, ERR-GA-001 — case quan trọng nhất, phải có message/comment rõ ràng trong test giải thích đây là safety-critical test).
  - Case không gộp khi khoảng cách vượt ngưỡng (AC-003).
  - Case không gộp khi có dấu kết câu (AC-004).
  - (Khuyến nghị thêm) Case segment không overlap turn nào → không gộp (FR-009).
- test requirement: `pytest merge_segments_test.py` — toàn bộ test cũ (đã có cho `assign_speakers`) vẫn phải PASS song song, không được sửa/xoá test cũ.

---

## Phase 4 — GA-14: Benchmark đối chiếu mốc

### T-MERGE-005 ✅ — Chạy lại benchmark trên `04_ClimateDiscussion_10min.mp3`

- dependsOn: T-MERGE-001, T-MERGE-003, T-MERGE-004 (chỉ chạy sau khi cả VAD tuning + merge đã implement và unit test pass)
- files: Không tạo file mới bắt buộc — có thể tái sử dụng cách đo đã dùng cho mốc 2026-08-02 (script benchmark, xem `benchmark_resources.py` làm tham khảo đo RAM). Kết quả ghi vào `plan.md` (changelog) và báo cáo cho Thiếu Chủ, KHÔNG tự ý sửa mốc benchmark gốc trong `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mà không xin phép.
- acceptance criteria: Đối chiếu đúng 4 chỉ số ở plan.md mục 5 (tổng segment, tỷ lệ unknown, RTF, RAM đỉnh) so với mốc gốc. Nếu không đạt, KHÔNG tự coi feature "xong" — báo cáo lại, đề xuất hướng xử lý (tinh chỉnh ngưỡng/rollback một phần).
- test requirement: Đây là benchmark thủ công, không phải unit test tự động trong CI — nhưng phải có bằng chứng số liệu cụ thể (log/output) đính kèm báo cáo, không được chỉ nói "đã cải thiện" mà không có số.

---

## Dependencies & Execution Order

```text
T-VAD-000 (đã xong)
   │
   ├──► T-MERGE-001 (VAD tuning)
   │
   └──► T-MERGE-002 (hàm gộp mảnh) ──► T-MERGE-003 (chèn vào pipeline)
                    │
                    └──► T-MERGE-004 (unit test) [làm song song hoặc ngay sau T-MERGE-002]

T-MERGE-001 + T-MERGE-003 + T-MERGE-004 đều xong ──► T-MERGE-005 (benchmark, GATE cuối cùng)
```

**Điều kiện coi feature này DONE**: T-MERGE-005 đạt đủ 3/4 chỉ số bắt buộc (RTF không tăng quá 10%, unknown không tăng, tổng segment giảm rõ rệt) — RAM đỉnh chỉ là chỉ số theo dõi phụ, không phải gate cứng vì bước gộp không load thêm model.
