## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo spec.md ban đầu — GIAI ĐOẠN 1 của `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (GA-10→GA-14). Tách riêng thành feature nhỏ, không gộp vào `feat-offline-local-transcription-pipeline` vì đây là fix chất lượng trên pipeline đã chạy được, không phải dựng pipeline mới. | Toàn bộ file (mới) |

> File này là tài liệu documentation-first, **chưa code**. Nguồn quyết định gốc: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục "GIAI ĐOẠN 1 — Sửa lỗi ngắt câu" (đã chốt với Thiếu Chủ 2026-08-02 qua benchmark thật). Đối chiếu với code hiện có: `workers/ai-transcription/python/whisper_runner.py`, `merge_segments.py`, `transcribe_pipeline.py`, `merge_segments_test.py`, và feature liền trước `spec/features/transcription/feat-offline-local-transcription-pipeline/`.

---

# Feature Specification: Transcript Segment Merge (gộp mảnh câu theo lượt nói)

- **Feature ID**: TRANS-SEGMENT-MERGE-001
- **Feature Name**: Gộp các mảnh câu STT vụn thành lượt nói hoàn chỉnh + tinh chỉnh VAD, giảm tỷ lệ `unknown` do mảnh vắt ngang ranh giới người nói
- **Module / Domain**: `transcription` (AI Worker Python pipeline, không đụng NestJS API layer)
- **Created Date**: 2026-08-02
- **Status**: Draft
- **Source Documents**:
  - `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (mục 3 quyết định #6, mục 6.2 việc #2-3, GIAI ĐOẠN 1, mục 8.2, mục 11)
  - `spec/features/transcription/feat-offline-local-transcription-pipeline/spec.md` (feature nền, FR-009 diarization)
  - `workers/ai-transcription/python/whisper_runner.py`
  - `workers/ai-transcription/python/merge_segments.py`
  - `workers/ai-transcription/python/transcribe_pipeline.py`
  - `workers/ai-transcription/python/merge_segments_test.py`
  - `test_audio/04_ClimateDiscussion_10min.mp3`, `test_audio/discussion_climate.txt` (audio + kịch bản benchmark gốc)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Pipeline offline transcription (`feat-offline-local-transcription-pipeline`) đã chạy đúng luồng STT (faster-whisper) → diarization (pyannote) → `assign_speakers()`. Benchmark thật ngày 2026-08-02 trên `04_ClimateDiscussion_10min.mp3` (600s, 5 người nói, kịch bản gốc đã biết trước) phát hiện: faster-whisper cắt một câu/lượt nói liên tục thành nhiều mảnh vụn — ví dụ một câu bị cắt thành 4 mảnh liên tiếp cách nhau <3 giây. Tổng thể: 97 mảnh cho 41 lượt nói thật thu được (2.4 mảnh/lượt).

Tác hại nghiệp vụ: mảnh ngắn dễ nằm vắt ngang ranh giới đổi người nói trong diarization, khiến `overlapRatio` (tính trong `_dominant_speaker`, `merge_segments.py`) không đạt ngưỡng `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO=0.65` → bị gán `unknown` oan dù người nói rõ ràng xác định được. Benchmark đo được 6/97 segment (6.2%) rơi vào `unknown`.

Tính năng này thuộc GIAI ĐOẠN 1 trong kế hoạch tổng thể "Ghi Âm Cuộc Họp & Gán Danh Tính Người Nói" — làm **trước** GIAI ĐOẠN 2/3 (gán danh tính) vì giảm mảnh vụn sẽ giảm luôn tỷ lệ `unknown`, làm nền sạch hơn cho toàn bộ phần gán tên phía sau.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép AI Worker (Python pipeline nội bộ), sau khi có kết quả STT và diarization, **gộp các mảnh câu liên tiếp thuộc cùng một lượt nói của cùng một người** thành một segment hoàn chỉnh hơn trước khi chạy `assign_speakers()`, đồng thời điều chỉnh tham số VAD của faster-whisper để giảm việc cắt câu quá sớm ngay từ bước STT — nhằm giảm số lượng mảnh vụn và giảm tỷ lệ `unknown` do mảnh vắt ranh giới người nói, mà **không được đánh đổi bằng việc trộn lời của hai người nói khác nhau vào một segment**.

### 1.3 Giá trị mang lại

- Cho chất lượng transcript: câu văn liền mạch hơn, dễ đọc hơn, ít bị cắt giữa chừng.
- Cho GIAI ĐOẠN 2/3 (gán danh tính) sắp tới: nền segment sạch hơn, tỷ lệ `unknown` thấp hơn giúp Host ít phải sửa tay hơn.
- Cho đo lường/vận hành: có benchmark lặp lại được (`04_ClimateDiscussion_10min.mp3`) để so sánh trước/sau mỗi lần chỉnh pipeline sau này.

### 1.4 Giả định

- `DIARIZATION_ENABLED=true`/`OVERLAP_DETECTION_ENABLED=true` đã được bật thật trong `capstone-be/.env` (GIAI ĐOẠN 0, đã xong 2026-08-02) — tính năng này giả định diarization luôn chạy khi merge chạy; xem mục 1.5 CLR-002 cho case diarization tắt.
- `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO=0.65`, `SPEAKER_ASSIGN_MIN_CONFIDENCE=0.70` giữ nguyên (quyết định #6 trong plan tổng: "Giữ nguyên giá trị hiện tại, chỉ chỉnh nếu đo thấy cần") — feature này không chủ động đổi 2 ngưỡng này, chỉ đo lại xem có cần đổi không sau khi merge.
- Audio benchmark (`04_ClimateDiscussion_10min.mp3`) là giọng tổng hợp (TTS), sạch, không đại diện hoàn toàn cho phòng họp thật vọng âm — kết quả đo trong feature này **không** thay thế cho GA-50 (thu thử thật, thuộc phạm vi khác).
- `merge_segments.py` đã có sẵn `assign_speakers()`/`build_detected_speakers()` — hàm gộp mảnh mới **thêm vào cùng file này**, không tạo module Python mới, theo đúng vị trí plan tổng đã chỉ định (`python/merge_segments.py`).

### 1.5 Cần làm rõ

- **CLR-001**: Ngưỡng khoảng cách gộp cụ thể (plan tổng ghi "~0.8s") và tham số VAD cụ thể (`min_silence_duration_ms` hay tham số nào của faster-whisper) là **giá trị khởi điểm cần đo lại bằng benchmark (GA-14/T-BENCH-002)**, không phải hằng số chốt cứng — xem mục 4.1 Non-functional Requirements và `plan.md` mục kỹ thuật.
- **CLR-002**: Khi `DIARIZATION_ENABLED=false` (turns rỗng), pipeline hiện tại không có khái niệm "lượt nói" nào để xác định ranh giới an toàn cho việc gộp. Spec này **chốt: bước gộp CHỈ chạy trên nhánh diarization đã có turns** (tức bên trong `if diarization_enabled and turns:` của `transcribe_pipeline.py`, cùng vị trí `assign_speakers()` đang chạy) — khi không có turns, segment giữ nguyên như hiện tại (không gộp). Đây là diễn giải an toàn nhất, tránh gộp mù không có tín hiệu ranh giới người nói; team xác nhận nếu muốn mở rộng sau.
- **CLR-003**: Tinh chỉnh VAD (GA-10) và bước gộp mảnh (GA-11) là hai cơ chế độc lập nhưng cùng mục tiêu — spec này coi cả hai là **một feature** vì benchmark thành công/thất bại (GA-14) đo tác động gộp của cả hai cùng lúc trên cùng file audio. Nếu benchmark cho thấy chỉ một trong hai cơ chế mang lại cải thiện rõ, plan.md sẽ ghi rõ quyết định giữ/bỏ ở bước đó.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| AI Worker (internal Python process) | Actor duy nhất — chạy bước gộp mảnh như một bước nội bộ trong pipeline, không có actor con người nào gọi trực tiếp | Nhận segments thô từ whisper + turns từ diarization, trả về segments đã gộp cho `assign_speakers()` |
| Host/Organizer, Business Admin, System Admin | Người dùng cuối hưởng lợi gián tiếp (transcript đọc được tốt hơn) | Không tương tác trực tiếp với tính năng này — không có endpoint mới, không có DTO mới |

### 2.2 Role & Permission Rules

- Không có endpoint HTTP mới trong feature này → không có permission mới, không đổi RBAC.
- Không thay đổi authorization của các endpoint đã có trong `feat-offline-local-transcription-pipeline` (`transcript.create/read/update`).

### 2.3 Actor Constraints

- Không áp dụng (không có actor người dùng trực tiếp gọi feature này qua API).

---

## 3. Functional Requirements

> Toàn bộ Functional Requirements viết theo EARS. Giữ keyword EARS bằng tiếng Anh, nội dung nghiệp vụ bằng tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cung cấp một hàm gộp mảnh (segment merge) trong `python/merge_segments.py`, nhận vào danh sách segment thô từ faster-whisper và danh sách turn từ diarization, trả về danh sách segment đã gộp mà KHÔNG mutate danh sách đầu vào.
FR-002: THE system SHALL chỉ gộp hai segment liền kề khi cả ba điều kiện sau đều đúng: (a) cả hai segment cùng thuộc về một turn/speaker diarization chiếm ưu thế (cùng "lượt nói"), (b) khoảng cách thời gian giữa điểm kết thúc segment trước và điểm bắt đầu segment sau nhỏ hơn ngưỡng cấu hình được, (c) segment trước KHÔNG kết thúc bằng dấu kết câu (`.`, `!`, `?`).
FR-003: WHEN hai segment được gộp, THE system SHALL nối text của chúng (có khoảng trắng phân cách hợp lý), lấy `startMs` của segment trước và `endMs` của segment sau, và giữ lại các field còn lại (`sttConfidence`, ...) theo quy tắc tổng hợp nhất quán (ví dụ trung bình có trọng số theo độ dài).
FR-004: THE system SHALL truyền `vad_parameters` tường minh cho `faster_whisper.WhisperModel.transcribe()` trong `whisper_runner.py`, thay vì dùng `vad_filter=True` không kèm tham số (giá trị mặc định thư viện) như hiện tại.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN AI Worker chạy pipeline với `DIARIZATION_ENABLED=true` VÀ diarization trả về ít nhất một turn, THE system SHALL chạy bước gộp mảnh NGAY SAU khi có turns và TRƯỚC KHI gọi `assign_speakers()`.
FR-006: WHEN bước gộp mảnh hoàn tất, THE system SHALL log số lượng segment trước và sau khi gộp (theo cùng cơ chế `log_event` đã có trong `transcribe_pipeline.py`) để phục vụ đối chiếu benchmark.
```

### 3.3 State-driven Requirements

```text
FR-007: WHILE diarization đang TẮT (`DIARIZATION_ENABLED=false`) hoặc không có turn nào được trả về, THE system SHALL giữ nguyên hành vi hiện tại — KHÔNG chạy bước gộp mảnh, segments đi thẳng vào bước tổng hợp kết quả như trước khi có feature này (CLR-002).
```

### 3.4 Optional Feature Requirements

```text
FR-008: WHERE ngưỡng khoảng cách gộp và tham số VAD được cấu hình qua biến môi trường, THE system SHALL đọc giá trị từ env với giá trị mặc định hợp lý (không hard-code), theo đúng convention `_env_float`/`os.environ.get` đã dùng trong `merge_segments.py`/`whisper_runner.py`.
```

### 3.5 Unwanted Behavior Requirements

```text
ERR-GA-001 (an toàn cốt lõi, KHÔNG được vi phạm): IF hai segment liền kề thuộc về hai turn/speaker diarization KHÁC NHAU, THEN THE system SHALL KHÔNG BAO GIỜ gộp hai segment đó lại, bất kể khoảng cách thời gian giữa chúng gần đến đâu.
FR-009: IF một segment không giao (overlap) với bất kỳ turn diarization nào (không xác định được lượt nói), THEN THE system SHALL KHÔNG gộp segment đó với segment liền kề — giữ nguyên như một segment độc lập cho `assign_speakers()` xử lý theo logic `unknown` hiện có.
FR-010: IF quá trình gộp gặp segment có `text` rỗng hoặc thiếu field bắt buộc, THEN THE system SHALL bỏ qua việc gộp segment đó và giữ nguyên pipeline không crash.
```

### 3.6 Requirement Notes

- Yêu cầu an toàn `ERR-GA-001` là ràng buộc quan trọng nhất của toàn bộ tính năng — trực tiếp lấy từ "Ràng buộc an toàn bắt buộc" trong plan tổng (mục GIAI ĐOẠN 1). Mọi implementation, test, và code review đều phải verify riêng lẻ yêu cầu này.
- FR-004 (VAD) và FR-001→FR-003 (gộp mảnh) là hai cơ chế độc lập về code nhưng cùng đo chung trong AC benchmark (mục 7).

### 3.7 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Plan tổng GA-11 | Hàm mới trong `merge_segments.py` |
| FR-002 | Ubiquitous (điều kiện phức hợp) | Plan tổng GIAI ĐOẠN 1 "Ràng buộc an toàn bắt buộc" | 3 điều kiện AND, không được nới lỏng |
| FR-004 | Ubiquitous | Plan tổng GA-10 | `whisper_runner.py:55-70` |
| FR-005 | Event-driven | Plan tổng GA-12 | Vị trí chèn trong `transcribe_pipeline.py` |
| FR-007 | State-driven | CLR-002 | Diarization tắt → không gộp |
| ERR-GA-001 | Unwanted Behavior | Plan tổng "Ràng buộc an toàn bắt buộc" | Ưu tiên cao nhất |
| FR-009 | Unwanted Behavior | Suy luận từ logic `_dominant_speaker` hiện có | Không overlap turn nào → không gộp |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL không làm tăng RTF (Real-Time Factor) đo trên `04_ClimateDiscussion_10min.mp3` quá 10% so với mốc benchmark hiện tại (RTF 1.726, đo 2026-08-02).
NFR-002: THE system SHALL không làm tăng RAM đỉnh đáng kể so với mốc benchmark hiện tại (2612.9 MB) — bước gộp mảnh xử lý thuần Python trên danh sách nhỏ (<200 segment/audio 10 phút), không load thêm model.
```

### 4.2 Reliability & Consistency

```text
NFR-003: THE system SHALL cho ra kết quả benchmark KHÔNG làm tăng tỷ lệ segment `unknown` so với mốc hiện tại (6/97 = 6.2%) — mục tiêu là GIẢM, chấp nhận "không tăng" là ngưỡng tối thiểu qua được giai đoạn.
NFR-004: THE system SHALL giảm rõ rệt tổng số segment so với mốc 97 trên cùng file benchmark (tiêu chí qua giai đoạn của plan tổng, không có số % cụ thể — do team đánh giá qua diff thật).
```

### 4.3 Maintainability

```text
NFR-005: THE system SHALL có unit test cho hàm gộp mảnh bao phủ tối thiểu 4 case: không gộp qua hai lượt nói khác nhau, không gộp khi khoảng cách vượt ngưỡng, không gộp khi segment trước kết thúc bằng dấu câu, gộp đúng khi cả ba điều kiện thỏa — đặt trong `python/merge_segments_test.py` (file đã có sẵn cho `assign_speakers`, thêm test case mới, không tạo file test riêng).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| Không có bảng database nào | Feature này thuần túy xử lý trong bộ nhớ (Python list/dict) trước khi ghi kết quả cuối vào `transcripts` | Không migration, không entity mới — đúng nguyên tắc CLAUDE.md mục 5.4 |

### 5.2 Dữ liệu đầu vào (in-memory, không phải API payload)

| Field | Type dự kiến | Bắt buộc | Mô tả |
|---|---:|---:|---|
| `segments` | `List[Dict]` | Có | Danh sách segment thô từ `whisper_runner.transcribe()` sau `new_segment()`, theo schema `REQUIRED_SEGMENT_FIELDS` trong `schemas.py` |
| `turns` | `List[Dict]` | Có | Danh sách turn diarization từ `diarization_runner.diarize()`, mỗi turn có `startMs`, `endMs`, `speakerLabel` |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `merged_segments` | `List[Dict]` | Danh sách segment đã gộp, giữ đúng shape schema segment hiện có (không thêm/bớt field so với `REQUIRED_SEGMENT_FIELDS`) — chuyển thẳng vào `assign_speakers()` như segments thường |

### 5.4 Data Constraints

- Không thay đổi shape/field của segment object hiện có trong `schemas.py` — bước gộp chỉ giảm SỐ LƯỢNG segment, không đổi cấu trúc.
- Segment sau khi gộp vẫn phải pass `validate_result()` (`schemas.py`) như segment thường.

### 5.8 Cần làm rõ

- Không phát sinh thêm ngoài mục 1.5.

---

## 6. Error Handling

```text
ERR-001: IF `segments` đầu vào rỗng, THEN THE system SHALL trả về danh sách rỗng, không lỗi.
ERR-002: IF `turns` đầu vào rỗng, THEN THE system SHALL trả về nguyên `segments` không gộp (đồng nhất với FR-007).
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given hai segment liền kề "Chủ đề của chúng ta là biến đổi khí hậu" (0-4.9s) và "Và tình trạng nóng lên toàn cầu" (5.1-7.5s), cả hai đều overlap chủ yếu với cùng turn Speaker_1, khoảng cách 0.2s, segment trước không kết thúc bằng dấu câu,
When bước gộp mảnh chạy,
Then hai segment được gộp thành một segment "Chủ đề của chúng ta là biến đổi khí hậu và tình trạng nóng lên toàn cầu" với startMs=0, endMs=7500.
```

### 7.2 Safety Cases (ưu tiên cao nhất)

```text
AC-002:
Given hai segment liền kề, segment A overlap chủ yếu với Speaker_1, segment B overlap chủ yếu với Speaker_2, khoảng cách giữa chúng chỉ 0.1s (rất gần),
When bước gộp mảnh chạy,
Then hai segment KHÔNG được gộp, giữ nguyên 2 segment riêng biệt.

AC-003:
Given hai segment liền kề cùng overlap với Speaker_1 nhưng khoảng cách giữa chúng là 3 giây (vượt ngưỡng cấu hình),
When bước gộp mảnh chạy,
Then hai segment KHÔNG được gộp.

AC-004:
Given hai segment liền kề cùng overlap với Speaker_1, khoảng cách 0.3s, nhưng segment trước có text kết thúc bằng dấu chấm ("Được rồi."),
When bước gộp mảnh chạy,
Then hai segment KHÔNG được gộp (coi là hai câu độc lập dù cùng người nói).
```

### 7.3 State Cases

```text
AC-005:
Given `DIARIZATION_ENABLED=false` (turns rỗng),
When pipeline chạy đến bước xử lý speaker,
Then bước gộp mảnh KHÔNG được gọi, segments giữ nguyên như hành vi hiện tại của pipeline (mọi segment `unknown`).
```

### 7.4 Benchmark Case (không phải unit test — quy trình đo tay/script)

```text
AC-006:
Given file `test_audio/04_ClimateDiscussion_10min.mp3` và cấu hình `medium` + pyannote CPU/int8 (giống hệt điều kiện đo mốc 2026-08-02),
When chạy lại toàn bộ pipeline sau khi có VAD tuning + merge,
Then số lượng segment giảm rõ rệt so với 97, tỷ lệ unknown không vượt quá 6.2%, và RTF không vượt quá 1.726 × 1.1 ≈ 1.90.
```

### 7.5 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-002, FR-003 | Happy path gộp đúng |
| AC-002 | ERR-GA-001 | An toàn — không gộp qua 2 người |
| AC-003 | FR-002(b) | Không gộp khi cách xa |
| AC-004 | FR-002(c) | Không gộp khi có dấu kết câu |
| AC-005 | FR-007 | Diarization tắt |
| AC-006 | NFR-001, NFR-003, NFR-004 | Benchmark so mốc |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Gán danh tính người nói thật (userId) — thuộc GIAI ĐOẠN 2/3 của plan tổng, feature riêng `feat-speaker-tagging-post-meeting`/`feat-speaker-tagging-live`.
- Word-level timestamp — plan tổng mục 3 quyết định #6 ghi rõ "Chưa làm word-timestamp".
- Nới thêm tham số chống lặp/hallucination (`repetition_penalty`, `no_repeat_ngram_size`) — plan tổng ghi rõ "chưa làm", đã có sẵn giá trị từ feature trước, không đổi trong feature này.
- Đổi `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO`/`SPEAKER_ASSIGN_MIN_CONFIDENCE` — chỉ đo lại, quyết định đổi (nếu có) thuộc phiên khác sau khi có số liệu.
- SpeechBrain SepFormer / xử lý overlap thật — đã ngoài phạm vi từ feature trước, không đổi ở đây.
- Bất kỳ thay đổi nào ở tầng NestJS API/DTO/entity — feature này chỉ chạm `workers/ai-transcription/python/`.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement speaker identity mapping (userId assignment) as part of this feature.
OOS-002: THE system SHALL NOT create new database tables, columns, or API endpoints as part of this feature.
OOS-003: THE system SHALL NOT change SPEAKER_ASSIGN_MIN_OVERLAP_RATIO or SPEAKER_ASSIGN_MIN_CONFIDENCE default values within this feature — only measure and report findings.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Đã có đủ 5 EARS basic patterns.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Error handling đã bao gồm case liên quan (không có auth/device vì feature không chạm layer đó).
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR.
- [x] Out of Scope đủ rõ.
- [x] Các phần thiếu thông tin đã đưa vào `Cần làm rõ` (CLR-001, CLR-002, CLR-003).
