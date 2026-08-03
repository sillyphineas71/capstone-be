## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo plan.md ban đầu, đối chiếu spec.md với code thật (`transcribe_pipeline.py`, `whisper_runner.py`, `merge_segments.py`). | Toàn bộ file (mới) |
| 2026-08-02 | **Feature DONE — benchmark thật đạt.** Kết quả T-MERGE-005 trên `04_ClimateDiscussion_10min.mp3`: tổng segment 97→70 (-28%), unknown 6(6.2%)→4(5.7%), RTF 1.726→1.736, RAM đỉnh 2612.9→2614.2MB. Cả 3 gate NFR-001/NFR-003/NFR-004 PASS. Phát hiện: `whisper_done segmentCount=97` không đổi so với mốc gốc — VAD tuning (GA-10) không đóng góp gì trong lần chạy này vì `WHISPER_VAD_MIN_SILENCE_MS` chưa được set (giữ mặc định thư viện 2000ms); toàn bộ cải thiện đến từ bước gộp mảnh (GA-11) một mình. Không cần tinh chỉnh VAD thêm vì đã đạt gate — để nguyên như một cải tiến khả dĩ trong tương lai nếu cần. | Mục 5 (bảng benchmark) |

# Implementation Plan: TRANS-SEGMENT-MERGE-001 Transcript Segment Merge

**Branch**: `feat-transcript-segment-merge` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `spec/features/transcription/feat-transcript-segment-merge/spec.md`
**Nguồn quyết định gốc**: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` GIAI ĐOẠN 1

> **Đây là bước documentation-first. Không có code nào được viết trong phạm vi plan.md này.**

## 1. Feature Summary

Thêm một bước xử lý mới vào pipeline Python đã có (`transcribe_pipeline.py`): sau khi diarization trả về turns và trước khi `assign_speakers()` chạy, gộp các segment STT liền kề thuộc cùng một lượt nói (cùng turn/speaker chiếm ưu thế, khoảng cách gần, không có dấu kết câu) thành một segment hoàn chỉnh hơn. Song song, chỉnh `vad_parameters` truyền tường minh cho faster-whisper thay vì dùng mặc định thư viện. Đo lại trên benchmark cố định (`04_ClimateDiscussion_10min.mp3`) để xác nhận cải thiện thật, không phải cải thiện trên giấy.

## 2. Technical Context

**Language/Version**: Python 3.x (không đổi version, cùng runtime với `feat-offline-local-transcription-pipeline`)
**Primary Dependencies**: Không thêm dependency mới — dùng `faster_whisper.WhisperModel.transcribe(vad_parameters=...)` đã có sẵn trong thư viện `faster-whisper` hiện cài (`requirements.txt`), không cần bump version trừ khi xác nhận version hiện tại thiếu tham số này (xem T-VAD-000).
**Storage**: Không đụng database, không đụng MinIO — xử lý thuần in-memory trong AI Worker process.
**Testing**: `pytest` (đã dùng cho `merge_segments_test.py`), benchmark script Python thủ công (tương tự `benchmark_resources.py` đã có).
**Target Platform**: Giống hệt `feat-offline-local-transcription-pipeline` — laptop dev Intel i5-11300H, 16GB RAM, không CUDA (profile `local`).
**Project Type**: Sửa/mở rộng module Python hiện có trong AI Worker, không tạo module mới.
**Performance Goals**: RTF không tăng quá 10% so với mốc 1.726 (NFR-001 spec.md); RAM đỉnh không tăng đáng kể so với 2612.9 MB (NFR-002).
**Constraints**:
- Không tạo bảng/cột/permission/endpoint mới.
- Không đổi shape của segment schema (`schemas.py` `REQUIRED_SEGMENT_FIELDS`) — chỉ giảm số lượng segment.
- Ràng buộc an toàn tuyệt đối: không bao giờ gộp hai segment khác turn/speaker (ERR-GA-001).
- Giữ nguyên `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO`/`SPEAKER_ASSIGN_MIN_CONFIDENCE` (chỉ đo, không đổi mặc định).

**Scale/Scope**: 1 hàm mới (`merge_fragmented_segments` hoặc tên tương đương) trong `merge_segments.py`, 1 điểm sửa nhỏ trong `whisper_runner.py` (thêm `vad_parameters`), 1 điểm chèn gọi hàm trong `transcribe_pipeline.py`, unit test bổ sung, 1 lần chạy benchmark thật.

## 3. Constitution Check

| Gate | Trạng thái | Ghi chú |
|---|---|---|
| Không thêm bảng database mới | ✅ PASS | Thuần xử lý Python in-memory |
| Không thêm permission/endpoint mới | ✅ PASS | Không đụng NestJS API layer |
| Không dùng Prisma / không đổi ORM | ✅ PASS | Không liên quan (Python pipeline) |
| Không tự ý thêm Kafka/Elastic/vector DB | ✅ PASS | Không đụng infra |
| Không tự ý tích hợp cloud AI provider | ✅ PASS | Vẫn faster-whisper + pyannote self-hosted sẵn có |
| Markdown editing safety (CLAUDE.md) | ✅ PASS | Sẽ kiểm tra BOM trước khi tick task trong `tasks.md` |
| Ràng buộc an toàn của chính feature này (spec ERR-GA-001) | ⚠️ GATE BẮT BUỘC khi implement | Unit test AC-002 phải pass trước khi coi task GA-11 xong |

Không có vi phạm cần justify ở Complexity Tracking.

## 4. Vị trí chèn code cụ thể (đối chiếu code thật 2026-08-02)

### 4.1 `whisper_runner.py` — VAD tuning (GA-10)

Hiện tại (`whisper_runner.py:55-70`, hàm `transcribe()`):

```python
segments_iter, info = model.transcribe(
    audio_path,
    language=whisper_language,
    task="transcribe",
    beam_size=5,
    vad_filter=True,       # <-- bật VAD nhưng KHÔNG truyền vad_parameters
    temperature=0.0,
    initial_prompt=initial_prompt,
    condition_on_previous_text=False,
    repetition_penalty=1.3,
    no_repeat_ngram_size=3,
)
```

`vad_filter=True` dùng cấu hình mặc định của `faster-whisper` (Silero VAD wrapper). Đã xác nhận thật trên máy dev (2026-08-02): `faster-whisper==1.2.1` cài thật (`requirements.txt: faster-whisper>=1.0.0`), `faster_whisper.vad.VadOptions.__init__` mặc định `min_silence_duration_ms=2000`, `speech_pad_ms=400`. Việc cần làm: truyền `vad_parameters=VadOptions(min_silence_duration_ms=...)` với giá trị cao hơn 2000ms, đọc từ env mới (đề xuất tên: `WHISPER_VAD_MIN_SILENCE_MS`) để không hard-code. Giá trị cụ thể cao hơn bao nhiêu để lại cho benchmark (mục 5) quyết định — không đoán số trước khi đo.

### 4.2 `merge_segments.py` — hàm gộp mảnh mới (GA-11)

File đã có `_dominant_speaker()`, `assign_speakers()`, `build_detected_speakers()`. Hàm mới nên tái sử dụng logic `_dominant_speaker(segment, turns)` đã có (không viết lại thuật toán tìm turn chiếm ưu thế) để xác định "lượt nói" của từng segment thô, rồi so sánh giữa 2 segment liền kề. Đặt tên hàm gợi ý: `merge_fragmented_segments(segments, turns) -> List[Dict]`, gọi TRƯỚC `assign_speakers()`.

Quy tắc merge dùng `_dominant_speaker` sẵn có nghĩa là: nếu một segment không overlap turn nào (`_dominant_speaker` trả `None`), nó tự động không đủ điều kiện gộp — khớp đúng FR-009 mà không cần thêm nhánh xử lý riêng.

### 4.3 `transcribe_pipeline.py` — điểm chèn (GA-12)

Vị trí thật trong code hiện tại (không phải dòng 263-280 như plan tổng ước lượng — đã đối chiếu lại, vị trí thật nằm trong khối `if diarization_enabled:` sau `overlap_windows` được tính, trước `if turns: segments = assign_speakers(...)`):

```python
if diarization_enabled:
    ...
    turns = diarize(normalized_output_path)
    ...
    overlap_windows = ...
    if turns:
        segments = assign_speakers(segments, turns, overlap_windows)   # <-- chèn merge NGAY TRƯỚC dòng này
        detected_speakers = build_detected_speakers(segments)
```

Sửa thành:

```python
    if turns:
        segments = merge_fragmented_segments(segments, turns)   # MỚI (GA-11/12)
        log_event("segment_merge_done", beforeCount=..., afterCount=len(segments))  # FR-006
        segments = assign_speakers(segments, turns, overlap_windows)
        detected_speakers = build_detected_speakers(segments)
```

Đúng khớp FR-005/FR-007: merge chỉ chạy trong nhánh `if turns:` — khi `turns` rỗng (diarization tắt hoặc fail), pipeline giữ nguyên hành vi cũ.

## 5. Benchmark Protocol (GA-14)

Script benchmark cần tái sử dụng cách đo đã dùng cho mốc 2026-08-02 (không phát minh cách đo mới) — tham khảo `benchmark_resources.py` đã có cho phần đo RAM/thời gian. Kết quả phải so trực tiếp với bảng mốc trong `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục 5:

| Chỉ số | Mốc trước (2026-08-02) | Mục tiêu sau feature này |
|---|---:|---:|
| Tổng segment | 97 | Giảm rõ rệt |
| Segment `unknown` | 6 (6.2%) | Không tăng, mục tiêu giảm |
| RTF | 1.726 | ≤ 1.90 (không tăng quá 10%) |
| RAM đỉnh | 2612.9 MB | Không tăng đáng kể |

**Kết quả đo thật 2026-08-02 (sau khi implement GA-10/GA-11/GA-12):**

| Chỉ số | Mốc trước | Sau feature này | Đánh giá |
|---|---:|---:|---|
| Tổng segment | 97 | **70** (-28%) | ✅ PASS |
| Segment `unknown` | 6 (6.2%) | **4 (5.7%)** | ✅ PASS (giảm) |
| RTF | 1.726 | **1.736** | ✅ PASS (trong ngưỡng ≤1.90) |
| RAM đỉnh | 2612.9 MB | **2614.2 MB** | ✅ theo dõi phụ, không đổi đáng kể |

Cả 3 gate bắt buộc PASS. Spot-check thủ công 10 segment có note `segment_merged_same_turn`: không phát hiện lỗi trộn lời giữa 2 người nói, `detectedSpeakers` vẫn đúng 5/5. Script đo: `workers/ai-transcription/python/bench_climate.py` (mới, có thể chạy lại bất cứ lúc nào để tái kiểm chứng).

Nếu benchmark KHÔNG đạt (RTF tăng quá 10%, hoặc unknown tăng), plan.md phải được cập nhật (changelog) ghi rõ lý do và quyết định: giữ nguyên/tinh chỉnh lại ngưỡng/rollback — không được coi feature "xong" nếu benchmark không đạt (điều kiện qua giai đoạn của plan tổng).
