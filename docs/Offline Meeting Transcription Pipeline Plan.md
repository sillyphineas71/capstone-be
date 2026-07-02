# PLAN — Triển khai Offline Meeting Transcription Pipeline cho CAPSTONE

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các mục thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tách rõ Local Development Profile và Production EC2 GPU Profile cho phù hợp với cấu hình laptop dev hiện tại (Intel i5-11300H, 16GB RAM, Intel Iris Xe — không có NVIDIA CUDA). Thêm mục 2.5 (profile, bảng so sánh, cơ chế chuyển đổi), viết lại mục 8 (env vars theo `AI_PROFILE`), viết lại mục 11 (risk, Hardware/GPU lên R1), tách mục 12 thành Definition of Done Local (12.1) và Production (12.2). Thêm task T002A–T002E (config/resource-guard) và T035A; cập nhật nội dung T014, T016, T019, T026, T038 theo hướng profile-aware. Không đổi scope bảo mật đã chốt (MinIO private, no outbound internet, no cloud STT). | Mục 1, 2, 2.5 (mới), 8, 9 (T002A–T002E mới, T014, T016, T019, T026, T035A mới, T038), 11, 12 |
| 2026-06-29 | Chốt lại theo quyết định mới: Production/High-Quality GPU mode (EC2 hoặc máy khác có GPU NVIDIA mạnh) là **future target, không phải MVP commitment** (chưa có ngân sách/timeline/instance type); Local MVP mặc định `small`/`medium` + `int8`, `large-v3` là high-quality mode optional; Phase 6-7 (pyannote/SepFormer full) theo nguyên tắc architecture-first, optimize-after-GPU-available. Thêm task T-HF-001 (xin quyền HF gated model + preload pyannote trước build), T-DATA-001 (chuẩn bị audio test 2-5 phút, có overlap case, không commit audio thật), T-BENCH-001 (benchmark RAM/time để tinh chỉnh `AI_WORKER_MIN_FREE_RAM_MB`), T-STORAGE-001 (implement MinIO/S3 adapter thật trước T010). Chốt cơ chế RAM guard: Node `os.freemem()` đo trước khi spawn Python, Python `psutil` chỉ diagnostic. Thêm caveat Production DoD: STT tiếng Việt là draft, phụ thuộc mic/noise/accent/overlap, Host/Admin phải review trước khi publish minutes. Không đổi rule bảo mật đã chốt. | Mục 1, 2.5.3, 8.2, 9 (T-HF-001, T-DATA-001, T-BENCH-001, T-STORAGE-001 mới; T002E cập nhật), 11 (R1, R3), 12.2 |
| 2026-06-29 | Thêm mục 9.0 "Lộ trình triển khai theo milestone (M1-M4)" để chia 47 task/13 phase thành 4 milestone độc lập, demo được sau mỗi milestone, tránh rủi ro hết thời gian capstone mà không có gì hoàn chỉnh: M1 lõi STT (bắt buộc), M2 diarization/overlap, M3 SepFormer (optional, có thể cắt), M4 hoàn thiện/security/testing/docs (làm đan xen song song). Không đổi nội dung/task ID hiện có, chỉ gắn nhãn thứ tự ưu tiên. | Mục 9 (9.0 mới) |
| 2026-06-29 | Sửa lỗi encoding/mojibake còn sót lại trong toàn file (ví dụ: "lu'u"→"lưu", "U'u tiên"→"Ưu tiên", "bằng"→"bảng" khi ý là table, "Trå"→"Trả", "cổ gán"→"cố gán", "Chăn"→"Chặn", "Chay"→"Chạy", "Lửu"→"Lưu", "Viêt"→"Viết", "tôn tại"→"tồn tại", "Ö'"→"Ở", ký tự bullet "•" chuẩn hoá về "\-" cho đồng nhất với phần còn lại của file). Không đổi nội dung nghiệp vụ, chỉ sửa chính tả/ký tự hỏng. Đồng thời tách toàn bộ nội dung sang cấu trúc Speckit tại `spec/features/transcription/feat-offline-local-transcription-pipeline/` (spec.md, plan.md, tasks.md, quickstart.md, contracts/). File plan.md gốc này được giữ lại làm tài liệu nguồn/lịch sử quyết định, không còn là tài liệu thi hành chính. | Toàn bộ file (chính tả), không đổi cấu trúc mục |

## 0. Tên feature đề xuất

feat-offline-local-transcription-pipeline

## 1. Mục tiêu

Triển khai pipeline transcription chạy offline/self-hosted cho recording sau khi cuộc hợp kết thúc.

Pipeline phải đáp ứng các quyết định đã chốt:

\- Core STT provider: faster-whisper large-v3 self-hosted.

\- Diarization / speaker segmentation / overlap detection: pyannote.audio.

\- Speech separation: SpeechBrain SepFormer, chỉ chạy khi pyannote phát hiện overlapped speech.

\- SepFormer là best-effort, không được ép gán speaker nếu kết quả không đủ tin cây.

\- Nếu speaker không chắc chắn, lưu speakerLabel = "unknown" hoặc đánh dấu

lowConfidence = true, manualReviewRequired = true.

\- Recording/audio lưu trong MinIO private bucket.

\- Job transcription điều phối qua background\_jobs + BullMQ.

\- AI worker chạy trong private network, không có outbound internet tại runtime.

\- Model weights phải preload sẵn trong Docker image hoặc mounted model volume.

\- MVP không dùng cloud STT/API bên ngoài để tránh rò rỉ dữ liệu nội bộ.

\- Pipeline phải chạy được trên 2 môi trường rõ ràng, năng lực phần cứng khác nhau: **Local Development** (laptop/máy cá nhân — MVP commitment) và **Production/High-Quality GPU mode** (future target — hiện CHƯA có xác nhận ngân sách/timeline/instance type, xem mục 2.5.3 và mục 11 R1).

\- Local MVP mặc định dùng `faster-whisper small` hoặc `medium` với `compute_type=int8`. `large-v3` KHÔNG phải mặc định MVP — chỉ là **high-quality mode optional**, chỉ kích hoạt khi máy đang chạy (local hoặc production, không nhất thiết phải là EC2) có GPU NVIDIA đủ mạnh (đủ VRAM cho `float16`).

\- Phần pyannote.audio (full) và SpeechBrain SepFormer (full) triển khai theo nguyên tắc **architecture-first, optimize-after-GPU-available**: làm đúng kiến trúc/interface/config-driven và chạy được ở mức demo trên CPU trước; tối ưu hiệu năng/chất lượng chỉ thực hiện sau khi có GPU thật. SepFormer luôn chỉ best-effort, chỉ chạy khi pyannote phát hiện overlapped speech.

**Lưu ý quan trọng (cập nhật 2026-06-29):** các quyết định công nghệ ở trên (`faster-whisper large-v3`, `pyannote.audio` đầy đủ, `SpeechBrain SepFormer`) là **kiến trúc đích cho Production/High-Quality GPU mode**, hiện tại là **future target, KHÔNG phải MVP commitment** vì chưa có xác nhận ngân sách/timeline/instance type cụ thể (mục 2.5.3, mục 11 R1). Laptop local dev hiện tại (Intel Core i5-11300H, 4 core/8 thread, 16GB RAM, Intel Iris Xe Graphics — không có NVIDIA CUDA, không VRAM rời) không đủ năng lực để chạy `large-v3` ở chất lượng/độ trễ production. MVP local development dùng model nhỏ hơn (`small`/`medium`), chạy CPU, mục tiêu chỉ là validate luồng end-to-end — không phải đo hiệu năng hay chất lượng sản phẩm cuối. Chi tiết ở mục 2.5.

## 2. Nguyên tắc triển khai bắt buộc

Agent phải tuân thủ các rule sau trước khi code:

1. Đọc AGENTS.md, API\_CONTRACT\_v1.0\_with\_system\_roles.md,

database\_v3\_2\_compact\_39\_tables.md, và module/spec transcription hiện có nếu có.

2. Không thêm bằng mới nếu chưa có yêu cầu rõ ràng.

3. Ưu tiên dùng bảng hiện có:

4. recording\_sessions

5. media\_files

6. background\_jobs

7. transcripts

8. Không lưu audio/transcript/raw payload nhạy cảm vào log.

9. Không gọi bất kỳ cloud STT/API bên ngoài nào trong MVP.

10. Không để AI worker tự tải model từ internet lúc runtime.

11. Không hard-code MinIO credentials, model path, threshold, bucket name.

12. Mỗi API ghi dữ liệu phải có authorization, error handling và audit log nếu là thao tác sensitive.

13. Nếu có schema change bắt buộc, phải tạo TypeORM migration rõ ràng; tuy nhiên plan này ưu tiên không schema change.

14. Không hard-code model size, device (`cpu`/`cuda`), compute_type trong code Python hoặc Node worker. Toàn bộ phải đọc từ `AI_PROFILE` và các biến môi trường liên quan (mục 8), để chuyển giữa Local Development và Production EC2 GPU chỉ bằng cấu hình, không sửa code.

## 2.5. Môi trường triển khai: Local Development vs Production EC2 GPU

## 2.5.1. Bối cảnh

Pipeline trong plan này phải chạy được trên ít nhất 2 môi trường có năng lực phần cứng rất khác nhau:

\- **Local development**: laptop cá nhân của dev/agent, dùng để code, debug, validate logic và luồng end-to-end.

\- **Production/future deployment**: server/EC2 có GPU NVIDIA, dùng để chạy pipeline ở chất lượng/độ chính xác mục tiêu thật.

Cấu hình laptop local development hiện tại đã được xác nhận:

| Thành phần | Giá trị |
| --- | --- |
| CPU | Intel Core i5-11300H, 4 core / 8 thread |
| RAM | 16GB |
| GPU | Intel Iris Xe Graphics (iGPU, không có CUDA, không có VRAM rời) |
| Disk | NVMe SSD 512GB |

**Hệ quả kỹ thuật trực tiếp:**

\- Không có NVIDIA CUDA → `faster-whisper`, `pyannote.audio`, `SpeechBrain SepFormer` trên máy này chỉ chạy được ở CPU mode, không có GPU acceleration.

\- RAM 16GB phải chia sẻ giữa: hệ điều hành, IDE, Docker Desktop, container Postgres + Redis + MinIO + Backend API + AI worker (có thể phải load model Whisper + pyannote + SepFormer cùng lúc). Đây là giới hạn cứng, không phải giả định.

\- `large-v3` (~3GB weights, khuyến nghị ≥10GB VRAM ở `float16`, hoặc rất chậm/tốn nhiều RAM ở CPU) **không phù hợp để chạy thường xuyên trên máy này**.

**Nguyên tắc bắt buộc cho toàn bộ phần còn lại của plan:**

> Local development KHÔNG dùng để benchmark hoặc đánh giá chất lượng production. Local development CHỈ dùng để xác nhận pipeline chạy đúng luồng (job được tạo → enqueue → worker xử lý → transcript được lưu → speaker segment hợp lý → overlap được đánh dấu đúng quy tắc). Không ai được kỳ vọng laptop này transcribe nhanh hoặc chính xác như production.

## 2.5.2. Local Development Profile

Áp dụng khi `AI_PROFILE=local` (xem mục 8).

| Thành phần | Cấu hình local |
| --- | --- |
| Whisper model | `small` (mặc định) hoặc `medium` (nếu RAM còn dư, chấp nhận chậm hơn) — **không dùng `large-v3`** |
| Whisper device | `cpu` (bắt buộc, máy không có CUDA) |
| Whisper compute type | `int8` (ưu tiên, giảm RAM và tăng tốc CPU inference đáng kể so với `float32`) |
| Diarization (pyannote) | Bật được để test, nhưng **phải ghi log/README cảnh báo rõ: chạy CPU nên chậm**, không dùng làm tiêu chí "đạt"/"chưa đạt" performance |
| Overlap detection | Bật, dùng output diarization phía trên — logic không đổi giữa 2 môi trường, chỉ tốc độ khác |
| Speech separation (SepFormer) | **Mặc định OFF** (`SEPARATION_ENABLED=false`). Có thể bật optional/best-effort để test, nhưng đây là thành phần nặng nhất trong 3 model, nên giới hạn chỉ chạy trên overlap segment rất ngắn (vài giây) khi bật, và phải có cơ chế tắt nhanh qua config nếu máy quá tải |
| Audio input | Chỉ test với sample ngắn **2–5 phút** (xem `MAX_AUDIO_DURATION_LOCAL_SECONDS`) |
| Kỳ vọng thời gian xử lý | Không cam kết. Có thể vài chục giây đến vài phút cho audio 2-5 phút, tuỳ model/compute_type — chấp nhận được cho mục đích validate flow |
| Mục tiêu | Validate end-to-end flow: tạo job → BullMQ → worker → Python pipeline → transcript JSON → lưu DB → speaker assignment logic đúng quy tắc unknown/low-confidence |
| Không kỳ vọng | Xử lý nhanh meeting dài 30–60 phút. Không benchmark WER/độ chính xác. Không dùng kết quả local để đánh giá chất lượng sản phẩm cuối |

Guard bắt buộc khi chạy ở `AI_PROFILE=local`:

\- Worker phải reject/early-fail job nếu audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` (mặc định 300s) với error code rõ ràng (`AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`), trước khi load model — không được âm thầm xử lý rồi treo máy.

\- Nếu RAM dự kiến không đủ để load đồng thời các model đã enable (whisper + pyannote + sepformer), worker nên có cơ chế downgrade/skip thành phần (mặc định tự tắt SepFormer) thay vì crash cứng — chi tiết ở mục 9 (T002E).

## 2.5.3. Production / High-Quality GPU Profile (future target — chưa là MVP commitment)

**Trạng thái: future/production target.** Tại thời điểm viết plan này, EC2 GPU **chưa có xác nhận ngân sách, timeline, hoặc instance type cụ thể**. Mục này mô tả kiến trúc/cấu hình cần có KHI profile này được triển khai thật — không phải cam kết tiến độ MVP. MVP hiện tại chỉ cam kết đạt mục 2.5.2 (Local Development Profile).

Áp dụng khi `AI_PROFILE=production-gpu`. Profile này không bắt buộc phải chạy trên EC2 — nó áp dụng cho **bất kỳ máy nào có GPU NVIDIA đủ mạnh** (EC2 GPU instance khi được duyệt, hoặc một workstation/server khác có CUDA và đủ VRAM). "EC2" trong tên các mục dưới đây chỉ là ví dụ triển khai phổ biến, không phải yêu cầu duy nhất.

**Yêu cầu cứng:** để chạy `large-v3` + `pyannote.audio` (full) + `SpeechBrain SepFormer` ở chất lượng/độ trễ chấp nhận được cho sản phẩm thật, **bắt buộc có GPU NVIDIA với CUDA** (nếu dùng EC2: ví dụ dòng `g4dn.xlarge`/`g5.xlarge` hoặc tương đương, khuyến nghị ≥16GB VRAM để chạy đồng thời 3 model thoải mái; có thể chạy với ít VRAM hơn nếu chấp nhận chạy tuần tự/swap model). Đây **không phải gợi ý chung "đẩy lên EC2 là mạnh hơn"** — EC2 CPU-only **không** giải quyết được vấn đề hiệu năng của plan này, vì bản chất giới hạn là thiếu GPU/CUDA, không phải thiếu CPU core.

| Thành phần | Cấu hình production-gpu |
| --- | --- |
| Whisper model | `large-v3` |
| Whisper device | `cuda` |
| Whisper compute type | `float16` |
| Diarization (pyannote) | Bật, full pipeline |
| Overlap detection | Bật |
| Speech separation (SepFormer) | Bật, chạy trên GPU |
| Audio input | Không giới hạn 2-5 phút như local; hỗ trợ meeting dài 30-90 phút qua chunking (T015) |
| Kỳ vọng | Thời gian xử lý gần hoặc nhanh hơn real-time tuỳ độ dài audio và tải GPU |

**EC2 CPU-only (không có GPU) — trường hợp dự phòng nếu ngân sách chưa cho phép GPU instance:**

\- Không dùng `large-v3` làm mặc định. Áp dụng fallback giống local profile (`small`/`medium`, `compute_type=int8`), chấp nhận xử lý chậm hơn real-time đáng kể.

\- Đây vẫn được coi là "production deployment" về hạ tầng (network isolation, MinIO, BullMQ...) nhưng **không đạt chất lượng STT/diarization mục tiêu** của plan. Phải ghi rõ trong tài liệu vận hành để team/khách hàng không kỳ vọng sai.

\- SepFormer trên EC2 CPU-only nên giữ `SEPARATION_ENABLED=false` trừ khi đã đo thực tế thấy chấp nhận được.

## 2.5.4. Bảng so sánh Local vs Production

| Tiêu chí | Local Development (laptop hiện tại) | Production EC2 GPU |
| --- | --- | --- |
| `AI_PROFILE` | `local` | `production-gpu` |
| Whisper model | `small` (mặc định) / `medium` (optional) | `large-v3` |
| Whisper device | `cpu` | `cuda` |
| Whisper compute_type | `int8` | `float16` |
| Diarization (pyannote) | Bật, chậm trên CPU, chỉ để test | Bật, full tốc độ trên GPU |
| Overlap detection | Bật (logic giống production) | Bật |
| SepFormer (separation) | OFF mặc định, optional best-effort, giới hạn đoạn ngắn | Bật, best-effort như thiết kế gốc |
| Giới hạn độ dài audio | 2–5 phút (`MAX_AUDIO_DURATION_LOCAL_SECONDS=300`) | Không giới hạn cứng, có chunking cho audio dài (T015) |
| GPU/VRAM | Không có (Intel Iris Xe, iGPU) | NVIDIA GPU bắt buộc cho chất lượng mục tiêu |
| RAM thực tế | 16GB, chia sẻ với toàn bộ Docker stack | Theo EC2 instance type, dự kiến dư dả hơn |
| Mục tiêu chính | Validate luồng end-to-end, debug logic | Đạt chất lượng/độ trễ production |
| Dùng kết quả để đánh giá chất lượng sản phẩm? | Không | Có |

## 2.5.5. Cơ chế chuyển đổi giữa hai môi trường

\- Việc chuyển môi trường chỉ thông qua thay đổi biến môi trường `AI_PROFILE` + các biến model/device/compute_type liên quan (mục 8). **Không hard-code** model/device ở bất kỳ đâu trong code Python hoặc Node worker (rule 14, mục 2).

\- Python pipeline đọc toàn bộ config (model name, device, compute_type, enable flags, max duration) từ env tại thời điểm khởi động, không tự suy luận hoặc tự động detect GPU rồi âm thầm đổi hành vi — nếu `AI_PROFILE=production-gpu` nhưng container không thấy CUDA, worker phải fail fast với lỗi rõ (`CUDA_NOT_AVAILABLE_FOR_PROFILE`), không tự fallback âm thầm về CPU (T002C).

\- README/quickstart (T037) phải có 2 ví dụ `.env` riêng: một cho local, một cho production-gpu.

## 3. Kiến trúc tổng thể

## 3.1. Component chính

## 3.1.1. Backend API — NestJS transcription module

Trách nhiệm:

\- Nhận yêu cầu tạo transcription job.

\- Validate quyền, meeting, recording session, source media file.

\- Tạo row background\_jobs.

\- Tạo hoặc cập nhật row transcripts ở trạng thái processing.

\- Đẩy job vào BullMQ queue.

\- Cung cấp API xem transcript và trạng thái job.

Không chạy model AI trực tiếp trong Backend API.

## 3.1.2. BullMQ transcription queue

Queue đề xuất:

```yaml
queue name: transcription
job name: generate_meeting_transcript
jobId: transcription:{backgroundJobId}
```

Trách nhiệm:

\- Điều phối xử lý async.

\- Retry job khi lỗi tạm thời.

\- Chống duplicate bằng jobId.

\- Cho phép worker xử lý riêng, không block HTTP request.

## 3.1.3. AI Worker

AI Worker là process/container riêng, chạy trong private network.

Khuyến nghị cho MVP:

\- AI Worker là Node/NestJS worker process có thể consume BullMQ trực tiếp.

\- Trong container AI Worker có Python runtime + Python script để chạy model.

\- Node worker lấy job từ BullMQ, tải audio từ MinIO private bucket, gọi Python pipeline bằng child\_process, nhận output JSON, rồi cập nhật DB qua service/repository nội bộ.

Cách này giúp vẫn dùng BullMQ đúng stack hiện tại, không cần thêm Celery/RabbitMQ/Python queue mới.

## 3.1.4. Python AI pipeline

Python script chịu trách nhiệm:

1. Chuẩn hóa audio.

2. Chạy faster-whisper large-v3.

3. Chạy pyannote.audio để diarization, speaker segmentation, overlap detection.

4. Nếu phát hiện overlap, cắt đoạn overlap và chạy SpeechBrain SepFormer best-effort.

5. Gộp kết quả STT + diarization + separation thành JSON chuẩn.

6. Không ghi output nhạy cảm ra stdout/stderr ngoài JSON kết quả cần thiết.

## 3.1.5. MinIO private bucket

MinIO lưu:

\- Recording audio/video gốc.

\- Audio extracted/normalized nếu cần.

\- File phụ trợ nếu cần debug nội bộ, nhưng MVP nên hạn chế lưu intermediate file.

AI Worker truy cập MinIO bằng SDK/internal credential, không dùng public URL.

## 4. Luồng xử lý nghiệp vụ

## 4.1. Trigger tạo transcription job

Có 2 trigger hợp lệ:

Trigger A — Manual

Host hoặc Business Admin gọi:

POST /api/v1/meetings/{meetingId}/transcription-jobs

Body:

```txt
2. Check permission transcript.create.
```

```json
{
    "recordingSessionId": "uuid",
    "language": "vi-VN",
    "speakerMappingMode": "channel_zone",
    "forceRerun": false
}
```

## Trigger B — Auto sau khi recording completed

Sau khi recording hoàn tất và media\_files đã có file audio hợp lệ, hệ thống có thể tự enqueue transcription job nếu recording\_configs.enable\_transcription = true.

Với MVP, nên ưu tiên Manual trước. Auto trigger làm sau khi Manual flow ổn định.

## 4.2. Backend tạo job

Backend thực hiện:

1. Validate JWT.

3. Check meetingId tồn tại.

4. Check user có quyền với meeting:

5. Host/Organizer của meeting.

6. Business Admin/System Admin.

7. Participant có quyền nếu policy cho phép.

8. Check recordingSessionId thuộc meeting.

9. Tìm source media\_files :

```txt
10. recording_session_id = recordingSessionId
```

11. file\_type = audio hoặc audio extract từ video nếu recording chỉ có video.

```txt
12. is_active = true
```

```txt
13. deleted_at IS NULL
```

14. Nếu đã có transcript đang processing và forceRerun = false, trả lỗi 409 TRANSCRIPTION\_JOB\_ALREADY\_RUNNING.

15. Tạo background\_jobs :

```txt
16. job_type = transcription_generate
```

```txt
17. status = queued
18. related_entity_type = meeting
```

```txt
19. related_entity_id = meetingId
20. payload_json chứa meetingId, recordingSessionId, sourceMediaFileId, language, speakerMappingMode.
```

```txt
21. Tạo hoặc cập nhật transcripts :
```

```txt
22. meeting_id = meetingsId
```

```txt
23. recording_session_id = recordingSessionId
24. source_media_file_id = sourceMediaFileId
25. background_job_id = backgroundJobId
26. status = processing
27. security_status = pending_scan
28. Enqueue BullMQ job.
29. Trả 202 Accepted.
```

## 4.3. AI Worker xử lý job

Worker thực hiện:

1. Nhận BullMQ job.

```txt
2. Update background_jobs.status = processing.
```

```txt
3. Update transcripts.status = processing.
```

4. Tải source audio/video từ MinIO private bucket.

5. Nếu input là video, extract audio bằng ffmpeg.

6. Normalize audio:

7. mono hoặc giữ channel nếu cần mapping channel/seat.

8. sample rate 16kHz.

9. format WAV/FLAC nội bộ.

10. Chạy faster-whisper large-v3.

11. Chạy pyannote.audio.

12. Align STT segments với diarization segments.

13. Nếu pyannote phát hiện overlap:

\- Extract overlap window.

\- Chạy SpeechBrain SepFormer best-effort.

\- Chạy STT lại trên separated streams nếu separation đủ tin cây.

\- Merge lại segment.

14. Tính confidence tổng hợp.

15. Ghi kết quả vào transcripts.

```txt
16. Update background_jobs.status = completed.
```

17. Cleanup temp files.

```txt
Nếu lỗi:
```

```txt
1. Update transcripts.status = failed.
2. Update background_jobs.status = failed.
3. Ghi error code ngắn gọn, không ghi transcript/audio content vào log.
4. Nếu lỗi do model/worker thì gửi notification nội bộ cho Admin nếu module notification đã sẵn sàng.
```

## 5. Quy tắc gán speaker

## 5.1. Nguyên tắc

Không được cố gán speaker nếu không chắc chắn.

Mỗi segment nên có cấu trúc logic như sau trong speaker\_segments\_json :

```json
{
    "segmentId": "seg-0001",
    "startMs": 1250,
    "endMs": 5840,
    "text": "Nội dung transcript",
    "speakerLabel": "Speaker_1",
    "speakerSource": "pyannote",
    "userId": null,
    "channelId": null,
    "roomZoneLabel": null,
    "sttConfidence": 0.91,
    "diarizationConfidence": 0.82,
    "separationConfidence": null,
    "finalConfidence": 0.86,
    "overlap": false,
    "lowConfidence": false,
    "manualReviewRequired": false,
    "notes": []
}
```

## 5.2. Khi nào gán unknown

Gán:

```txt
"speakerLabel": "unknown"
```

nếu gặp một trong các trường hợp:

\- Segment nằm trong overlapped speech nhưng SepFormer không tách đủ tốt.

\- Diarization có nhiều speaker cùng overlap mà không có speaker chiếm ưu thế rõ.

\- Segment quá ngắn để xác định speaker.

\- Confidence thấp hơn threshold.

\- Mapping channel/zone/user không đủ dữ liệu.

\- Kết quả STT có text nhưng speaker detection không chắc.

## 5.3. Threshold đề xuất

Đặt trong config, không hard-code:

```txt
SPEAKER_ASSIGN_MIN_OVERLAP_RATIO=0.65
SPEAKER_ASSIGN_MIN_CONFIDENCE=0.70
OVERLAP_DETECTION_MIN_CONFIDENCE=0.60
SEPARATION_ACCEPT_MIN_CONFIDENCE=0.72
TRANSCRIPT_MANUAL_REVIEW_THRESHOLD=0.75
```

Giải thích:

\- SPEAKER\_ASSIGN\_MIN\_OVERLAP\_RATIO : tỷ lệ thời gian một speaker chiếm trong segment để được gán speaker.

\- SPEAKER\_ASSIGN\_MIN\_CONFIDENCE : confidence tối thiểu để gán speaker.

\- SEPARATION\_ACCEPT\_MIN\_CONFIDENCE : nếu SepFormer tách tiếng thấp hơn ngưỡng này thì không dùng kết quả tách để gán speaker.

\- TRANSCRIPT\_MANUAL\_REVIEW\_THRESHOLD : transcript tổng thấp hơn ngưỡng này thì đánh dấu cần review.

## 6. Data mapping vào DB hiện có

## 6.1. media\_files

Dùng để lưu metadata file recording/audio.

Yêu cầu:

\- Không lưu file binary vào PostgreSQL.

\- storage\_provider = minio.

\- storage\_bucket là private bucket.

\- storage\_key là object key nội bộ.

\- file\_url không bắt buộc lưu với private file; signed URL nên sinh runtime khi user có quyền xem.

\- metadata\_json có thể lưu codec, sample rate, channel count, model input info.

```txt
- status :
```

## 6.2. background\_jobs

Dùng để tracking job async.

Payload đề xuất:

```json
{
    "jobType": "transcription_generate",
    "meetingId": "uuid",
    "recordingSessionId": "uuid",
    "sourceMediaFileId": "uuid",
    "language": "vi-VN",
    "provider": "local_faster_whisper",
    "diarizationProvider": "pyannote",
    "separationProvider": "speechbrain_sepformer",
    "forceRerun": false,
    "modelVersions": {
    "whisper": "large-v3",
    "pyannote": "configured-local-version",
    "sepformer": "configured-local-version"
    }
}
```

## 6.3. transcripts

Dùng để lưu kết quả cuối cùng.

Mapping đề xuất:

\- meeting\_id: meeting được transcription.

\- source\_media\_file\_id: audio/video source.

\- recording\_session\_id: recording session nguồn.

\- background\_job\_id: job xử lý.

\- version\_no : tăng khi force rerun hoặc chính sửa.

\- language\_code : ví dụ vi-VN .

\- raw\_text : text thô từ faster-whisper.

\- cleaned\_text : MVP có thể bằng raw\_text ; chính sửa thủ công cập nhật sau.

\- speaker\_segments\_json : danh sách segment có timestamp/speaker/confidence.

\- detected\_speakers\_json : danh sách speaker phát hiện.

\- security\_status: pending\_scan hoặc trạng thái hiện có theo policy.

\- confidence\_score: confidence tổng hợp.

```txt
- approved
- failed
- hidden
```

Với MVP, sau khi AI xử lý xong nên set status = draft, vì transcript cần Host/Admin review trước khi coi là chính thức.

## 7. Cấu trúc thư mục đề xuất

## 7.1. Backend

```ignorefile
src/modules/transcription
transcription.module.ts
transcription.controller.ts
transcription.service.ts
transcription-worker.processor.ts
dto/
create-transcription-job.dto.ts
transcription-response.dto.ts
query-transcript.dto.ts
entities/
transcript.entity.ts
constants/
transcription-job.constants.ts
transcription-error-codes.ts
types/
transcript-segment.type.ts
transcription-provider.type.ts
```

## 7.2. AI Worker scripts

```shell
workers/ai-transcription
    Dockerfile
    package.json
    src/
    ai-transcription.worker.ts
    transcription-job-runner.ts
    minio-audio-loader.ts
    transcript-result-writer.ts
    python/
    transcribe_pipeline.py
    audio_preprocess.py
    whisper_runner.py
```

```ignorefile
diarization_runner.py
overlap_detector.py
sepformer_runner.py
merge_segments.py
schemas.py
tests/
fixtures/
```

## 7.3. Model volume

```ignorefile
/models
faster-whisper-large-v3/
pyannote/
speechbrain-sepformer/
```

## 8. Environment variables đề xuất

Biến môi trường được tổ chức theo 3 nhóm: (a) biến chọn profile, (b) biến model/device theo từng profile, (c) biến hạ tầng dùng chung (model path theo size, MinIO, queue, threshold gán speaker) — không đổi giữa các profile.

## 8.1. Biến chọn profile

```txt
AI_PROFILE=local            # local | production-gpu | production-cpu-fallback
```

`AI_PROFILE` là nguồn sự thật duy nhất để chọn cấu hình model/device (T002A). Không dùng `NODE_ENV` để quyết định model AI — `NODE_ENV` và `AI_PROFILE` là 2 khái niệm khác nhau (một dev có thể chạy `NODE_ENV=development` nhưng `AI_PROFILE=production-gpu` khi test trên máy GPU staging).

## 8.2. Local Development Profile (mặc định cho laptop dev hiện tại)

```txt
AI_PROFILE=local

WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

DIARIZATION_ENABLED=true
OVERLAP_DETECTION_ENABLED=true
SEPARATION_ENABLED=false

MAX_AUDIO_DURATION_LOCAL_SECONDS=300
AI_WORKER_MIN_FREE_RAM_MB=2048
AI_WORKER_MAX_CONCURRENT_JOBS=1
```

Ghi chú:

\- `WHISPER_MODEL=small` là mặc định khuyến nghị cho laptop hiện tại (Intel i5-11300H, 16GB RAM, không CUDA). Có thể đổi thủ công sang `medium` để test độ chính xác cao hơn, miễn là biết sẽ chậm hơn đáng kể.

\- `SEPARATION_ENABLED=false` là mặc định vì SepFormer là model nặng nhất trong 3 model (mục 11, R4). Có thể bật tạm để test nhưng phải giới hạn overlap segment ngắn.

\- `MAX_AUDIO_DURATION_LOCAL_SECONDS` được worker đọc để guard (T002B): audio dài hơn giá trị này bị reject ngay khi `AI_PROFILE=local`.

\- `AI_WORKER_MIN_FREE_RAM_MB=2048` dùng cho cơ chế tự skip SepFormer khi thiếu RAM (T002E). **Đây chỉ là initial estimate, chưa đo thật** — giá trị này phải được tinh chỉnh lại theo số đo thực tế từ T-BENCH-001 trước khi coi là threshold chính thức.

## 8.3. Production / High-Quality GPU Profile (future target, chưa là MVP commitment — mục 2.5.3)

```txt
AI_PROFILE=production-gpu

WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16

DIARIZATION_ENABLED=true
OVERLAP_DETECTION_ENABLED=true
SEPARATION_ENABLED=true

AI_WORKER_MAX_CONCURRENT_JOBS=1
```

`MAX_AUDIO_DURATION_LOCAL_SECONDS` không áp dụng ở profile này — worker chỉ enforce giới hạn đó khi `AI_PROFILE=local` (T002B). Nếu cần giới hạn độ dài audio trên production, dùng biến riêng (ví dụ `MAX_AUDIO_DURATION_PRODUCTION_SECONDS`) khi triển khai thật, không tái dùng biến của local profile để tránh nhầm lẫn 2 ngữ cảnh.

## 8.4. EC2 CPU-only fallback profile (dự phòng, không phải mục tiêu chính)

```txt
AI_PROFILE=production-cpu-fallback

WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

DIARIZATION_ENABLED=true
OVERLAP_DETECTION_ENABLED=true
SEPARATION_ENABLED=false
```

Chỉ dùng khi production deployment chưa có EC2 GPU. Phải ghi rõ trong tài liệu vận hành: chất lượng/tốc độ không đạt mục tiêu plan (mục 2.5.3).

## 8.5. Model path & infra dùng chung (mọi profile, không hard-code)

```txt
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_PROVIDER=local_faster_whisper
TRANSCRIPTION_QUEUE_NAME=transcription

WHISPER_MODEL_PATH_SMALL=/models/faster-whisper-small
WHISPER_MODEL_PATH_MEDIUM=/models/faster-whisper-medium
WHISPER_MODEL_PATH_LARGE_V3=/models/faster-whisper-large-v3

PYANNOTE_MODEL_PATH=/models/pyannote
PYANNOTE_LOCAL_FILES_ONLY=true

SEPFORMER_MODEL_PATH=/models/speechbrain-sepformer
SEPFORMER_LOCAL_FILES_ONLY=true

AI_WORKER_TEMP_DIR=/tmp/smrmpts-ai
AI_WORKER_NO_OUTBOUND_INTERNET=true

SPEAKER_ASSIGN_MIN_OVERLAP_RATIO=0.65
SPEAKER_ASSIGN_MIN_CONFIDENCE=0.70
OVERLAP_DETECTION_MIN_CONFIDENCE=0.60
SEPARATION_ACCEPT_MIN_CONFIDENCE=0.72
TRANSCRIPT_MANUAL_REVIEW_THRESHOLD=0.75

MINIO_ENDPOINT=http://minio:9000
MINIO_PRIVATE_BUCKET=smrmpts-private-media
MINIO_ACCESS_KEY=${SECRET}
MINIO_SECRET_KEY=${SECRET}
```

Lưu ý:

\- Model path tách theo size (`_SMALL`, `_MEDIUM`, `_LARGE_V3`) vì local và production cần preload/mount các model khác nhau trong cùng image hoặc volume; không xoá model nhỏ khi build image cho production — giữ khả năng fallback nếu GPU lỗi/hết VRAM.

\- AI worker chọn đúng path theo `WHISPER_MODEL` đang active (T002A, T026), không hard-code path trong code.

\- Threshold gán speaker (`SPEAKER_ASSIGN_MIN_*`, `SEPARATION_ACCEPT_MIN_CONFIDENCE`...) giữ nguyên giữa các profile — đây là business logic, không phụ thuộc hardware.

\- Không commit `.env`. Không để HuggingFace token trong runtime container nếu không cần. Model chỉ tải ở build/preload phase, dùng máy có internet riêng để xin quyền/license cho pyannote (gated model trên HuggingFace) rồi mới bake vào image/volume — không tải ở runtime container (mục 2.5.5, mục 11 R3).

## 9. Task breakdown cho agent

Ngoài T001-T038 gốc, plan này bổ sung các task dùng prefix riêng (`T-HF-001`, `T-DATA-001`, `T-BENCH-001`, `T-STORAGE-001`) thay vì chèn số vào giữa dãy T0xx, để không phải renumber các task đã có. Vị trí thực thi thực tế của chúng trong luồng task:

\- `T002A`-`T002E` (Phase 0.5): ngay sau T002, trước Phase 1.

\- `T-DATA-001`, `T-BENCH-001`: cuối Phase 0.5, sau T002E, trước Phase 1 — `T-BENCH-001` chạy benchmark thật sau khi Phase 4-7 chạy được ít nhất 1 lần, nhưng được khai báo sớm vì kết quả ảnh hưởng ngược lại `AI_WORKER_MIN_FREE_RAM_MB` của T002E.

\- `T-STORAGE-001`: đầu Phase 3, ngay trước T010 (T010 phụ thuộc trực tiếp).

\- `T-HF-001`: đầu Phase 6, ngay trước T016 (T016/T026 phụ thuộc trực tiếp).

## 9.0. Lộ trình triển khai theo milestone (M1-M4)

Toàn bộ task/phase ở mục 9 KHÔNG nên coi là một khối phải hoàn thành hết mới có giá trị demo được — với quy mô task hiện tại (T001-T038 + T002A-E + T-HF-001 + T-DATA-001 + T-BENCH-001 + T-STORAGE-001, 13 phase), rủi ro lớn nhất không phải kỹ thuật mà là **quản lý tiến độ**: nếu hết thời gian giữa đường, dễ rơi vào tình trạng không có gì hoàn chỉnh để demo. Vì vậy task breakdown được nhóm thành 4 milestone độc lập, theo đúng ranh giới phase đã có sẵn — không đổi nội dung/task ID, chỉ gắn nhãn thứ tự ưu tiên thực thi và điểm dừng an toàn.

### M1 — Lõi STT (bắt buộc, giá trị tối thiểu phải có)

Gồm: Phase 0, Phase 0.5 (T002A-E, T-DATA-001, T-BENCH-001), Phase 1, Phase 2, Phase 3 (T-STORAGE-001, T010, T011), Phase 4, Phase 5.

Mục tiêu: tạo transcription job → BullMQ → AI worker → faster-whisper (`small`/`medium`, CPU, `int8`) → có raw transcript text lưu vào `transcripts`. Không phụ thuộc diarization/separation. **Mọi milestone sau đều build trên M1** — không bắt đầu M2 trước khi M1 chạy end-to-end được ít nhất 1 lần (tạo job → có transcript), để tránh debug nhiều lớp cùng lúc.

### M2 — Diarization + Overlap Detection

Gồm: T-HF-001, Phase 6 (T016-T018).

Mục tiêu: thêm speaker label + đánh dấu overlap vào transcript đã có từ M1. Phụ thuộc cứng vào T-HF-001 (phải có người accept HuggingFace license + preload model trước khi bắt đầu T016) và vào M1 đã chạy được.

### M3 — SepFormer best-effort (có thể cắt nếu hết thời gian)

Gồm: Phase 7 (T019-T020).

Mục tiêu: tách overlap segment best-effort. Đây là milestone rủi ro/nặng nhất về hiệu năng và chất lượng (mục 11 R4), và đã được thiết kế optional/default-off (`SEPARATION_ENABLED=false` ở local, mục 8.2). **Nếu timeline không đủ, có thể bỏ hẳn milestone này** mà không phá vỡ M1/M2 — pipeline vẫn hoàn chỉnh, chỉ overlap segment bị đánh dấu `unknown`/`manualReviewRequired` thay vì được tách tiếng. Không bắt đầu M3 trước khi M2 chạy được, vì SepFormer chỉ có ý nghĩa khi đã có overlap detection từ M2.

### M4 — Hoàn thiện (persistence, security, testing, docs)

Gồm: Phase 8, Phase 9, Phase 10, Phase 11 (gồm T035A), Phase 12.

Mục tiêu: build JSON transcript cuối cùng, hardening bảo mật (no external STT, no outbound internet, sensitive logging), notification, test, docs/quickstart. Phần lớn task ở đây — đặc biệt Phase 9 (security) và phần test của Phase 11 ứng với M1/M2 — nên làm **đan xen song song** với M1-M3 ngay khi phần tương ứng xong, không cần chờ M3 hoàn tất mới bắt đầu. Chỉ riêng T034 (overlap smoke test) và phần test SepFormer trong T035A phụ thuộc M3.

### Nguyên tắc chốt cho demo capstone

\- Demo capstone tối thiểu = M1 hoàn chỉnh + phần M4 tương ứng (security/testing cho M1). Đây là mức "phải đạt".

\- M2 là nâng cao có giá trị rõ ràng nếu kịp tiến độ.

\- M3 là optional, chấp nhận cắt hoàn toàn nếu thiếu thời gian — không ảnh hưởng Definition of Done của M1/M2.

## Phase 0 — Source alignment & scope lock

## T001 — Đọc source-of-truth và ghi lại quyết định scope

Mục tiêu:

\- Đọc AGENTS.md, DB Compact, API Contract, module transcription hiện có.

\- Xác nhận không thêm bảng mới.

\- Xác nhận dùng transcripts.speaker\_segments\_json và detected\_speakers\_json để lưu segment/speaker.

Output:

\- Ghi chú ngắn trong plan.md hoặc feature note:

\- Scope MVP.

\- Out of scope.

\- DB mapping.

\- API mapping.

Done khi:

\- Agent liệt kê đúng bảng dùng.

\- Không đề xuất thêm table như transcript\_segments, audio\_segments, speaker\_profiles nếu chưa được duyệt.

## T002 — Kiểm tra codebase hiện tại của modules liên quan

Mục tiêu:

\- Kiểm tra các module:

\- recording

\- transcription

\- notifications

\- background\_jobs

\- queue/BullMQ setup

\- MinIO/storage service

\- Xác định file nào đã có, file nào cần tạo mới.

## Output:

\- Danh sách "reuse existing" và "need implement".

\- Không sửa code ở task này nếu chưa cần.

Done khi:

\- Agent biết chính xác hiện tại đã có TranscriptEntity, BackgroundJobEntity, storage service, queue module hay chưa.

## Phase 0.5 — Config & Resource Profile Architecture (mới, làm ngay sau T002, trước Phase 1)

Lý do thêm phase này: laptop dev hiện tại không có GPU/CUDA và chỉ có 16GB RAM (xem mục 2.5). Nếu không xây cơ chế chọn profile/model/device qua config NGAY TỪ ĐẦU, các phase sau (Phase 5-7) sẽ bị viết cứng theo `large-v3`/`cuda` rồi phải sửa lại. Các task T002A-T002E nên được làm trước khi bắt đầu Phase 5 (faster-whisper), dù số ID lớn hơn các task ở Phase 1-4 — số ID không phản ánh thứ tự thực thi, đây chỉ là task được bổ sung sau khi plan gốc đã có T001-T038.

## T002A — Định nghĩa AI_PROFILE và bảng cấu hình model/device/compute_type

Mục tiêu:

\- Tạo config module (phía Node worker và phía Python pipeline) đọc `AI_PROFILE` (`local` | `production-gpu` | `production-cpu-fallback`) và map sang `WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, `DIARIZATION_ENABLED`, `OVERLAP_DETECTION_ENABLED`, `SEPARATION_ENABLED`, `MAX_AUDIO_DURATION_LOCAL_SECONDS` (mục 8).

\- Không hard-code giá trị nào trong code, chỉ đọc từ env.

Done khi:

\- Đổi `AI_PROFILE` trong `.env` thì toàn bộ worker đổi hành vi mà không cần sửa code.

\- Có unit test cho 3 profile (`local`, `production-gpu`, `production-cpu-fallback`).

## T002B — Resource guard: giới hạn duration audio khi local

Mục tiêu:

\- Khi `AI_PROFILE=local`, worker kiểm tra duration audio trước khi tải model. Nếu dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS`, reject ngay với error `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`.

Done khi:

\- Audio 6 phút bị reject ngay khi profile local + limit 300s, không load model, không treo job.

\- Audio 4 phút được xử lý tiếp bình thường.

## T002C — Fail-fast khi thiếu GPU cho production-gpu

Mục tiêu:

\- Khi `AI_PROFILE=production-gpu` nhưng container không detect được CUDA, worker fail fast ngay khi startup với lỗi rõ `CUDA_NOT_AVAILABLE_FOR_PROFILE`.

\- Không tự động fallback âm thầm sang CPU — vì nếu âm thầm fallback, team sẽ tưởng nhầm production đang chạy `large-v3` trên GPU trong khi thực tế đang chạy rất chậm trên CPU.

Done khi:

\- Test giả lập container không có CUDA + `AI_PROFILE=production-gpu` → worker unhealthy/crash rõ ràng ngay khi start, có log lý do.

## T002D — Logging model/device/compute_type đang dùng cho mỗi job

Mục tiêu:

\- Mỗi job log (không chứa nội dung nhạy cảm) rõ: `jobId`, `aiProfile`, `whisperModel`, `device`, `computeType`, `diarizationEnabled`, `separationEnabled`, thời gian xử lý từng giai đoạn (preprocess/STT/diarization/separation).

Done khi:

\- Có thể đọc log để biết job nào chạy bằng config nào, không cần đọc code hoặc hỏi lại dev.

## T002E — Cơ chế downgrade/skip an toàn khi local thiếu tài nguyên

Mục tiêu:

\- Nếu `AI_PROFILE=local` và hệ thống phát hiện RAM khả dụng thấp hơn ngưỡng cấu hình (`AI_WORKER_MIN_FREE_RAM_MB`), worker tự động skip SepFormer (nếu đang bật) và ghi warning vào kết quả (`warnings: ["sepformer_skipped_low_resources"]`) thay vì để job crash hoặc treo máy.

\- faster-whisper và pyannote KHÔNG bị skip tự động — đây là phần lõi bắt buộc của STT/diarization. Chỉ SepFormer được phép tự skip vì nó đã là optional/best-effort theo thiết kế gốc (mục 1, mục 5.1).

\- **Cơ chế đo RAM đã chốt:** Node AI Worker dùng `os.freemem()` để kiểm tra RAM khả dụng **ngay trước khi spawn Python child process** xử lý job (so với `AI_WORKER_MIN_FREE_RAM_MB`). Quyết định skip SepFormer được đưa ra ở phía Node, trước khi Python process bắt đầu chạy bất kỳ model nào. Python `psutil` (nếu dùng) chỉ phục vụ mục đích benchmark/diagnostic/logging chi tiết tiến trình con (T-BENCH-001), **không** dùng để ra quyết định skip.

Done khi:

\- Test mô phỏng RAM thấp → SepFormer tự skip, job vẫn hoàn thành, segment overlap liên quan được đánh dấu `manualReviewRequired=true` thay vì làm job fail toàn bộ.

\- Có thể xác minh quyết định skip được đưa ra ở phía Node (qua log/test), không phụ thuộc vào việc Python container có cài `psutil` hay không.

## T-DATA-001 — Chuẩn bị audio test 2-5 phút cho local development

Mục tiêu:

\- Chuẩn bị tối thiểu 2 file audio mẫu dùng cho T014, T016, T033, T034, T035A và toàn bộ local development:

1. Audio đơn giản, 1-2 người nói rõ ràng, không overlap — dùng để validate STT/diarization cơ bản.

2. Audio có ít nhất 1 đoạn overlapped speech (2 người nói chồng tiếng) — dùng để validate overlap detection + SepFormer best-effort (T017-T020, T034).

\- Ưu tiên audio giả lập/dựng sẵn (ví dụ tự ghi âm đọc kịch bản giả, hoặc dataset public không nhạy cảm), KHÔNG dùng recording cuộc họp thật của công ty cho mục đích test trong Git.

\- Cả 2 file đều trong khoảng 2-5 phút, đúng giới hạn `MAX_AUDIO_DURATION_LOCAL_SECONDS` (mục 8.2).

Done khi:

\- Audio mẫu được lưu trong `workers/ai-transcription/tests/fixtures/` (mục 7.2), là audio giả lập, không phải audio thật của công ty.

\- Có quy ước/`.gitignore` rõ ràng đảm bảo không commit audio/transcript THẬT vào Git; nếu sau này cần test thủ công bằng audio thật, phải để ngoài Git (ví dụ qua MinIO hoặc folder local-only).

\- T033 (smoke test không overlap) và T034 (smoke test overlap) có file audio tương ứng để chạy.

## T-BENCH-001 — Benchmark RAM/thời gian xử lý trên máy local để tinh chỉnh threshold

Mục tiêu:

\- `AI_WORKER_MIN_FREE_RAM_MB=2048` (mục 8.2, dùng trong T002E) hiện chỉ là **initial estimate**, chưa đo thật trên máy dev (Intel i5-11300H, 16GB RAM).

\- Sau khi Phase 4-7 chạy được tối thiểu 1 lần trên local bằng audio mẫu của T-DATA-001 (faster-whisper `small`/`medium` + pyannote, có và không có SepFormer), đo:

\- RAM peak khi chạy riêng từng model.

\- RAM peak khi chạy đồng thời whisper + pyannote (+ SepFormer nếu bật).

\- Thời gian xử lý cho audio mẫu 2-5 phút ở từng tổ hợp model/compute_type.

\- Đo bằng Node `os.freemem()`/`os.totalmem()` tại thời điểm trước/trong/sau khi spawn Python — nhất quán với cơ chế RAM guard đã chốt ở T002E. Có thể dùng Python `psutil` để log thêm chi tiết tiến trình con cho mục đích diagnostic, nhưng số đo quyết định threshold cuối cùng phải lấy từ phía Node.

Done khi:

\- Có bảng số đo thực tế (RAM peak, thời gian xử lý) cho ít nhất 3 tổ hợp: `small+cpu+int8` (không SepFormer), `medium+cpu+int8` (không SepFormer), `small+cpu+int8` + SepFormer trên overlap ngắn.

\- `AI_WORKER_MIN_FREE_RAM_MB` trong `.env`/docs được cập nhật lại theo số đo thật, không còn là giá trị đoán.

\- Kết quả benchmark được ghi vào docs (T036) làm tài liệu tham khảo nội bộ, không công bố như số liệu performance production.

## Phase 1 — API + DB integration

## T003 — Tạo/hoàn thiện TranscriptEntity mapping

Mục tiêu:

\- Map TypeORM entity cho bảng transcripts.

\- Không đổi schema nếu cột đã tồn tại.

\- Các field JSONB phải type rõ.

Các field cần chú ý:

\- speakerSegmentsJson

\- detectedSpeakersJson

\- confidenceScore

\- securityStatus

\- status

\- backgroundJobId

\- sourceMediaFileId

\- recordingSessionId

## Done khi:

\- Entity build pass.

\- Không dùng synchronize: true.

\- Không tạo migration nếu không có schema change.

## T004 — Tạo DTO cho transcription job

## Mục tiêu:

```txt
Tạo CreateTranscriptionJobDto :
```

```typescript
recordingSessionId: string;
language?: string; // default vi-VN
speakerMappingMode?: 'channel_zone' | 'diarization_only';
forceRerun?: boolean;
```

## Validation:

\- recordingSessionId phải là UUID.

\- language default vi-VN.

\- forceRerun default false.

## Done khi:

\- DTO có class-validator đầy đủ.

\- Unit test DTO pass.

## T005 — Implement POST transcription job API

Endpoint:

```batch
POST /api/v1/meetings/:meetingId/transcription-jobs
```

## Mục tiêu:

\- Validate meeting.

\- Validate recording session thuộc meeting.

\- Tìm source media file hợp lệ.

\- Chặn duplicate job nếu đang processing.

\- Tạo background\_jobs.

\- Tạo/cập nhật transcripts status processing.

\- Enqueue BullMQ job.

\- Trả 202 .

## Done khi:

\- API response đúng format.

\- Permission transcript.create.

\- Có error code rõ:

\- MEETING\_NOT\_FOUND

\- RECORDING\_SESSION\_NOT\_FOUND

\- SOURCE\_MEDIA\_NOT\_FOUND

\- TRANSCRIPTION\_JOB\_ALREADY\_RUNNING

\- TRANSCRIPTION\_DISABLED

## T006 — Implement GET transcript API

Endpoint:

GET /api/v1/meetings/:meetingId/transcript?includeSegments=true&page=1&limit=50

Mục tiêu:

\- Trả transcript mới nhất theo version\_no.

\- Nếu includeSegments=false, không trả full segment JSON để tránh response quá nặng.

\- Nếu includeSegments=true, hỗ trợ pagination segment trong JSON array.

Done khi:

\- Permission transcript.read

\- Chỉ Host/Participant có quyền hoặc Admin được xem.

\- Không leak transcript meeting khác.

## T007 — Implement background job status mapping

Mục tiêu:

\- Đảm bảo FE có thể xem job status qua endpoint background job hiện có.

\- Nếu chưa có endpoint, implement theo API convention hiện tại.

Done khi:

\- User gọi API tạo job nhận jobId.

\- User có thể query status queued, processing, completed, failed.

## Phase 2 — BullMQ worker orchestration

## T008 — Tạo BullMQ processor cho transcription queue

Mục tiêu:

\- Tạo processor nhận job generate\_meeting\_transcript.

\- Worker chỉ xử lý job nếu background\_jobs.status còn hợp lệ.

\- Dùng jobId = transcription:{backgroundJobId} để chống duplicate.

Done khi:

\- Job được consume thành công.

\- Retry policy rõ:

\- retry 2-3 lần cho lỗi tạm thời MinIO/IO.

\- không retry cho lỗi validation như source file missing.

\- Failed job cập nhật DB đầy đủ.

## T009 — Implement job lifecycle update

Mục tiêu:

\- Khi worker bắt đầu: set background\_jobs.status = processing.

\- Khi thành công: set completed.

\- Khi lỗi: set failed, lưu error code/message ngắn.

\- Cập nhật transcripts.status tương ứng.

Done khi:

\- Không có job treo processing vô thời hạn nếu worker crash.

\- Có cleanup hoặc recovery task cho job stuck nếu project đã có scheduler.

## Phase 3 — MinIO private media access

## T-STORAGE-001 — Cài và implement S3/MinIO-compatible storage adapter (làm trước T010)

Mục tiêu:

\- `StorageService` hiện tại (`src/modules/storage/storage.service.ts`) chỉ có driver `local`, chưa có driver S3/MinIO thật, dù MinIO container đã chạy sẵn trong `docker-compose.dev.yml`. Đây là gap thực tế đã xác nhận, phải đóng trước khi AI worker có thể tải audio từ MinIO private bucket — T010 phụ thuộc trực tiếp vào task này.

\- Cài package client MinIO (ví dụ `minio` npm package — ưu tiên hơn `@aws-sdk/client-s3` vì đơn giản, đúng mục đích MinIO-only) cho Backend API (và AI Worker nếu cần tải file trực tiếp bằng SDK riêng).

\- Implement đầy đủ driver `minio`/`s3` trong `StorageService`: upload, download, generate signed URL có thời hạn ngắn cho client có quyền xem, generate/đọc internal object key — không tạo public URL cho private bucket.

\- Đọc credentials (`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PRIVATE_BUCKET`, mục 8.5) từ env, không hard-code.

Done khi:

\- `StorageService` upload/download được file thật với MinIO container local.

\- AI worker (T010) tải được audio từ MinIO bằng driver này, không qua public URL.

\- Backend API sinh signed URL có thời hạn ngắn cho user có quyền xem media/transcript liên quan, không lưu signed URL vĩnh viễn vào DB.

\- Không log access key/secret (nhất quán với T010, T027).

## T010 — Implement internal MinIO audio loader

Mục tiêu:

\- Worker tải file từ media\_files.storage\_bucket + storage\_key.

\- Không dùng public URL.

\- Không tạo signed URL cho worker.

\- Validate checksum nếu có.

Done khi:

\- Worker tải được file private từ MinIO.

\- Nếu file không tồn tại, job failed với error rõ.

\- Không log access key/secret.

## T011 — Implement temp file lifecycle

Mục tiêu:

\- Lưu file tạm trong AI\_WORKER\_TEMP\_DIR.

\- Mỗi job có thư mục riêng.

\- Cleanup sau success/failure.

\- Không giữ audio tạm lâu hơn cần thiết.

Done khi:

\- Sau job hoàn tất, temp dir được xóa.

\- Nếu worker crash, startup cleanup xử lý temp dir cũ quá TTL.

## Phase 4 — Python audio preprocessing

## T012 — Implement ffmpeg audio normalization

Mục tiêu:

\- Convert input audio/video sang WAV 16kHz.

\- Nếu input là video, extract audio.

\- Nếu input multi-channel, giữ metadata channel nếu cần mapping channel\_zone.

Done khi:

\- Pipeline xử lý được .wav, .mp3, .m4a, .mp4.

\- Lỗi format trả về error UNSUPPORTED\_MEDIA\_FORMAT.

## T013 — Tạo Python result schema

Mục tiêu:

Python pipeline phải xuất JSON chuẩn:

```txt
{
    "languageCode": "vi-VN",
```

```txt
"rawText": "...",
"cleanedText": "...",
"confidenceScore": 0.87,
"segments": [],
"detectedSpeakers": [],
"modelVersions": {},
"warnings": []
}
```

Done khi:

\- Node worker parse được JSON.

\- Có validate schema trước khi ghi DB.

\- Nếu JSON invalid, job failed an toàn.

## Phase 5 — faster-whisper large-v3 STT

## T014 — Implement faster-whisper runner

Mục tiêu:

\- Load model từ path tương ứng với `WHISPER_MODEL` đang active (`WHISPER_MODEL_PATH_SMALL`/`_MEDIUM`/`_LARGE_V3`, mục 8), không hard-code `large-v3`.

\- Đọc `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE` từ config theo `AI_PROFILE` (T002A), không hard-code `cuda`/`float16`.

\- Dùng local\_files\_only hoặc cơ chế tương đương để không tải model runtime.

\- Chạy transcription theo language config.

\- Output segment có:

\- startMs

\- endMs

\- text

\- confidence hoặc avg logprob/no\_speech\_prob converted nếu có.

Done khi:

\- Chạy được sample audio offline trên **cả 2 profile**: local (`small`/`medium`, `cpu`, `int8`, audio 2-5 phút) và production-gpu (`large-v3`, `cuda`, `float16`, audio dài hơn).

\- Không có network call.

\- Output segment timestamp đúng.

\- Trên local profile, thời gian xử lý không cần đạt ngưỡng nào — chỉ cần hoàn thành và ra kết quả hợp lý cho audio ngắn. Không dùng kết quả thời gian chạy trên local để đánh giá "đạt"/"không đạt" hiệu năng.

## T015 — Chunking strategy cho audio dài

Mục tiêu:

\- Với recording dài, xử lý theo chunk để tránh OOM.

\- Chunk đề xuất: 5-10 phút, có overlap nhỏ 1-2 giây để tránh mất từ ở biên.

\- Merge chunk output theo timestamp global.

Done khi:

\- Audio 30-90 phút không làm worker crash.

\- Timestamp sau merge vẫn đúng.

## Phase 6 — pyannote diarization + overlap detection

Nguyên tắc cho phase này: **architecture-first, optimize-after-GPU-available**. Mục tiêu trên local development là làm đúng kiến trúc/interface (load model, sinh speaker turns, overlap detection logic), chạy được bằng CPU trên audio ngắn — KHÔNG phải tối ưu tốc độ. Tối ưu hiệu năng (audio dài hơn, tăng concurrency, giảm latency) chỉ thực hiện sau khi có Production/High-Quality GPU profile thật (mục 2.5.3), vì tối ưu sớm trên CPU-only sẽ lãng phí thời gian capstone vào phần không phải mục tiêu cuối.

**Tiền điều kiện bắt buộc:** T-HF-001 phải hoàn thành trước khi bắt đầu T016 (model pyannote phải đã được accept license + preload sẵn local).

## T-HF-001 — Xin quyền HuggingFace gated model cho pyannote và preload trước khi build image

Mục tiêu:

\- Một AI Worker/DevOps assignee được chỉ định rõ (không để ngỏ "ai đó làm") dùng máy CÓ INTERNET (không phải container runtime) để:

1. Đăng nhập Hugging Face, đọc và accept điều kiện sử dụng (gated model conditions) cho `pyannote/speaker-diarization-3.1` và `pyannote/segmentation-3.0`.

2. Tạo Hugging Face access token loại **READ** (không cần WRITE).

3. Dùng token đó tải model weights về máy có internet, rồi copy/preload vào model volume hoặc bake vào Docker image ở build stage.

\- Token KHÔNG được đưa vào image runtime, KHÔNG được commit vào Git, KHÔNG được dùng trong container AI worker lúc runtime.

\- Runtime container chỉ đọc model từ `PYANNOTE_MODEL_PATH` với `PYANNOTE_LOCAL_FILES_ONLY=true` (mục 8.5), không có khả năng gọi HuggingFace.

Done khi:

\- Model `pyannote/speaker-diarization-3.1` và `pyannote/segmentation-3.0` đã có sẵn trong model volume/image, load được mà container không cần internet.

\- Không có token/secret nào còn sót lại trong image hoặc biến môi trường runtime (kiểm tra tương tự T025/T035).

\- Có ghi chú trong docs (T036/T037): ai đã accept license, ngày accept, version model — tránh phải lặp lại bước này khi rebuild image sau này.

\- T016 và T026 chỉ được bắt đầu sau khi T-HF-001 hoàn thành.

## T016 — Implement pyannote diarization runner

Mục tiêu:

\- Load model từ PYANNOTE\_MODEL\_PATH.

\- Chạy diarization offline.

\- Output speaker turns:

\- startMs

\- endMs

\- speakerLabel

\- confidence nếu có.

Done khi:

\- Có danh sách speaker turn.

\- Không tải model từ internet.

\- Nếu diarization fail, STT vẫn có thể hoàn thành với speakerLabel = "unknown" và warning.

\- Chạy được trên local profile (CPU, audio 2-5 phút) — **lưu ý: trên CPU pyannote có thể chạy chậm, đây là hành vi đã biết, không phải bug**. Không dùng thời gian chạy ở local để đánh giá performance; chỉ cần xác nhận output diarization hợp lý về mặt logic.

## T017 — Implement overlap detection

Mục tiêu:

\- Dùng output pyannote để detect vùng có nhiều speaker cùng lúc.

\- Đánh dấu các time range overlap.

Done khi:

\- Segment nằm trong vùng overlap có overlap = true

\- Nếu không có overlap, không gọi SepFormer.

## T018 — Align STT segments với diarization

Mục tiêu:

\- Gộp output faster-whisper và pyannote.

\- Với mỗi STT segment, tìm speaker turn overlap lớn nhất.

\- Nếu speaker overlap ratio và confidence đạt threshold thì gán speaker.

\- Nếu không đạt thì gán unknown.

## Done khi:

\- Segment không overlap có speaker hợp lý.

\- Segment mơ hồ không bị ép speaker.

\- Có unit test cho các case:

\- 1 speaker rõ.

\- 2 speaker gần nhau.

\- overlap.

\- no diarization result.

## Phase 7 — SpeechBrain SepFormer best-effort

Nguyên tắc cho phase này: cũng theo **architecture-first, optimize-after-GPU-available** (giống Phase 6). SepFormer CHỈ được gọi khi pyannote (Phase 6) đã phát hiện overlapped speech — không bao giờ chạy SepFormer cho segment không overlap. Trên local development, phase này là optional/best-effort rõ ràng (`SEPARATION_ENABLED=false` mặc định, mục 8.2) — không phải tiêu chí bắt buộc để coi local demo là done (mục 12.1).

## T019 — Implement SepFormer runner optional

Mục tiêu:

\- Chỉ chạy khi overlap detection phát hiện overlapped speech VÀ `SEPARATION_ENABLED=true`.

\- Load model từ `SEPFORMER_MODEL_PATH`.

\- Có config bật/tắt `SEPARATION_ENABLED` (mục 8) — mặc định `false` ở local profile, `true` ở production-gpu profile.

Done khi:

\- Không overlap thì không gọi SepFormer.

\- Nếu SepFormer lỗi, pipeline không fail toàn bộ; chỉ đánh dấu segment overlap cần review.

\- Trên local profile: nếu bật để test, chỉ chạy trên overlap segment ngắn (gợi ý dưới 10 giây) để hạn chế tải RAM 16GB; có thể bị T002E tự skip khi thiếu tài nguyên — đây là hành vi mong đợi, không phải lỗi. SepFormer là model nặng nhất trong 3 model AI của plan này (xem mục 11, R4), nên local profile coi nó là optional rõ ràng, không phải tính năng bắt buộc phải chạy được trên laptop dev.

## T020 — Process separated overlap audio

Mục tiêu:

\- Vói overlap window:

\- cắt audio overlap + buffer nhỏ.

\- chạy SepFormer.

\- chạy faster-whisper trên separated stream nếu separation đạt ngưỡng.

\- merge text vào segment output.

## Done khi:

\- Nếu separation tốt, tạo subsegment có speaker/confidence.

\- Nếu separation không tốt:

\- speakerLabel = "unknown"

\- lowConfidence = true

\- manualReviewRequired = true

```json
[
    {
    "segmentId": "seg-0001",
    "startMs": 1000,
    "endMs": 5000,
    "speakerLabel": "Speaker_1",
    "text": "...",
    "sttConfidence": 0.91,
    "diarizationConfidence": 0.82,
    "separationConfidence": null,
    "finalConfidence": 0.86,
    "overlap": false,
    "lowConfidence": false,
    "manualReviewRequired": false
    }
]
```

```txt
- thêm warning "overlap_separation_low_confidence".
```

## Phase 8 — Transcript persistence

## T021 — Build final transcript JSON

Mục tiêu:

Tạo speaker\_segments\_json có format thống nhất:

Done khi:

\- JSON lưu được vào transcripts.speaker\_segments\_json.

\- Không vượt quá response size khi GET không include segments.

## T022 — Build detected speakers JSON

Mục tiêu:

```txt
Tạo detected_speakers_json :
```

```json
[
    {
    "speakerLabel": "Speaker_1",
    "totalSpeakingMs": 125000,
```

```txt
- raw_text, cleaned_text, speaker_segments_json, detected_speakers_json, confidence_score được cập nhật đúng.
- background_jobs.status đồng bộ.
```

```txt
"segmentCount": 18,
"mappedUserId": null,
"mappingSource": "diarization",
"confidence": 0.81
}
```

Done khi:

\- UI/Host có thể xem danh sách speaker phát hiện.

\- Chưa cần tự map user nếu chưa đủ dữ liệu.

## T023 — Update transcript final status

Mục tiêu:

\- Nếu pipeline thành công và confidence ổn: status = draft.

\- Nếu thành công nhưng nhiều segment low confidence: vẫn draft, nhưng metadata/warnings trong JSON đánh dấu cần review.

\- Nếu pipeline lỗi nghiêm trọng: status = failed.

Done khi:

## Phase 9 — Security hardening

## T024 — Enforce no external STT/API provider

Mục tiêu:

\- Không có code path gọi Google STT, OpenAI, Azure, AssemblyAI hoặc cloud STT khác.

\- Nếu config provider không phải local\_faster\_whisper, app fail startup trong MVP.

Done khi:

\- Search code không có external STT call.

\- Unit/config test verify provider chỉ là local.

\- README ghi rõ MVP offline-only.

## T025 — Enforce AI worker no outbound internet

## Mục tiêu:

## Ở Docker Compose/Staging:

\- AI worker không publish public port.

\- AI worker nằm trong private/internal network.

\- Chỉ kết nối được tới Redis, PostgreSQL nếu cần, MinIO, và internal backend service.

\- Chặn outbound internet ở runtime bằng Docker network/internal firewall/security group.

## Done khi:

\- AI worker không thể curl https://huggingface.co hoặc public internet từ container.

\- AI worker vẫn truy cập được MinIO/Redis nội bộ.

\- Có ghi chú triển khai trong docker compose/documentation.

## T026 — Model preload validation

## Mục tiêu:

\- Khi AI worker startup, validate model path tồn tại tương ứng với cấu hình `AI_PROFILE` đang active:

\- faster-whisper: validate đúng path của `WHISPER_MODEL` đang dùng (`small`/`medium`/`large-v3`) — không bắt buộc validate path `large-v3` nếu profile hiện tại không cần đến nó.

\- pyannote.

\- SpeechBrain SepFormer nếu `SEPARATION_ENABLED=true`.

\- Nếu `AI_PROFILE=production-gpu` mà container không detect CUDA, fail fast theo T002C (`CUDA_NOT_AVAILABLE_FOR_PROFILE`), tách riêng khỏi lỗi thiếu model.

\- Nếu thiếu model, worker fail fast với error rõ.

## Done khi:

\- Không có runtime download.

\- Log chỉ ghi thiếu path/model, không ghi secret.

\- Có healthcheck báo unhealthy nếu model missing.

## T027 — Sensitive logging policy

## Mục tiêu:

\- Không log raw transcript full.

\- Không log audio path public.

\- Không log MinIO secret.

\- Không log JWT/service token.

Done khi:

\- Logs chỉ có jobId, meetingId, recordingSessionId, status, duration, error code.

## Phase 10 — Notification & manual review support

## T028 — Mark manual review required

Mục tiêu:

\- Nếu transcript có nhiều low-confidence segment, đánh dấu trong JSON.

\- Có thể thêm summary trong detected\_speakers\_json hoặc metadata của transcript.

Done khi:

\- UI có thể nhận biết transcript cần review.

\- Không cần thêm bảng/manual review workflow mới trong MVP.

## T029 — Optional notification after transcript completed

Mục tiêu:

\- Khi transcript completed, gửi in-app notification cho Host nếu NotificationsService đã sẵn.

\- Nếu notification module chưa ổn định, bổ task này khởi MVP.

Done khi:

\- Notification đi qua NotificationsService/BullMQ, không tự insert notification bùa.

\- Không làm fail transcription nếu notification fail.

## Phase 11 — Testing

## T030 — Unit test service tạo transcription job

Test cases:

\- Meeting không tồn tại.

\- Recording session không thuộc meeting.

\- Không có source media file.

\- Có job đang processing và forceRerun = false.

\- Tạo job thành công.

Done khi:

\- Test service pass.

\- Error code đúng.

## T031 — Unit test speaker assignment logic

## Test cases:

\- Một speaker rõ ràng.

\- Segment nằm giữa 2 speaker nhưng không overlap.

\- Segment overlap 2 speaker.

\- Diarization missing.

\- Confidence thấp.

Done khi:

\- Low confidence case luôn ra unknown

\- Không có case ép gán speaker sai.

## T032 — Integration test BullMQ job lifecycle

## Test flow:

1. Tạo background job.

2. Enqueue BullMQ.

3. Worker consume.

4. Mock Python result.

5. Update transcript.

6. Mark job completed.

Done khi:

\- Job completed.

\- Transcript status draft.

\- JSON segments lưu đúng.

## T033 — AI pipeline smoke test với sample audio

## Mục tiêu:

\- Chạy sample audio ngăn 30-60 giây.

\- Có transcript text.

\- Có diarization output.

\- Không cần SepFormer nếu không có overlap.

## Done khi:

\- Python script chạy offline.

\- Output JSON valid.

## T034 — Overlap smoke test

## Mục tiêu:

\- Dùng sample audio có 2 người nói chồng.

\- Pyannote detect overlap.

\- SepFormer được gọi.

\- Nếu separation không chắc, segment bị mark manual review.

Done khi:

\- Best-effort behavior đúng.

\- Không crash pipeline khi SepFormer fail.

## T035 — Security test no internet

## Mục tiêu:

\- Exec vào AI worker container.

\- Thử gọi public internet.

\- Kết quả phải fail.

\- Thử truy cập MinIO internal.

\- Kết quả phải pass.

Done khi:

\- Có bằng chứng test trong quickstart hoặc checklist.

## T035A — Test resource guard & profile switching

Mục tiêu:

\- Test riêng cho các cơ chế thêm ở Phase 0.5 (T002B, T002C, T002E), vì đây là phần mới và là điểm dễ vỡ nhất khi laptop dev không đủ tài nguyên.

Test cases:

\- Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject ngay ở `AI_PROFILE=local`, không load model, error `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`.

\- `AI_PROFILE=production-gpu` nhưng container không có CUDA → fail fast `CUDA_NOT_AVAILABLE_FOR_PROFILE`, không tự fallback CPU.

\- Giả lập RAM khả dụng thấp ở local → SepFormer tự skip, job vẫn hoàn thành, segment liên quan có `manualReviewRequired=true` và warning `sepformer_skipped_low_resources`.

Done khi:

\- 3 test case trên pass.

\- Không có job nào treo vô thời hạn hoặc làm crash worker process trong các tình huống trên.

## Phase 12 — Documentation & demo

## T036 — Cập nhật feature documentation

Tài liệu cần có:

\- Kiến trúc pipeline.

\- Cách chạy local.

\- Cách preload model.

\- Cách chạy worker.

\- Cách test với sample audio.

\- Cách đọc transcript output.

\- Known limitations.

## Done khi:

\- Developer mới đọc docs có thể chạy được pipeline local.

\- Tài liệu ghi rõ MVP không dùng cloud STT/API.

## T037 — Viết quickstart cho agent/dev

## Quickstart nên gồm:

1. Start Postgres/Redis/MinIO.

2. Mount model volume.

3. Start backend API.

4. Start AI worker.

5. Upload/chuẩn bị recording file.

6. Call transcription job API.

7. Check background job.

8. Get transcript.

## Done khi:

\- Có command mẫu.

\- Không chứa secret thật.

## T038 — Demo acceptance checklist

Checklist được tách theo 2 môi trường — xem mục 12.1/12.2 để biết Definition of Done đầy đủ. Checklist dưới đây là bản rút gọn để demo.

## Checklist chung (áp dụng cả 2 môi trường):

\- Recording/audio nằm trong MinIO private bucket.

\- User tạo transcription job nhận 202.

\- background\_jobs có row queued/processing/completed.

\- BullMQ có job transcription.

\- AI worker xử lý offline.

\- transcripts có raw text, cleaned text, speaker segments.

\- Overlap segment không chắc được đánh dấu unknown/manual review.

\- AI worker không có outbound internet.

\- Không có cloud STT/API call.

\- Log thể hiện rõ `aiProfile`/`whisperModel`/`device`/`computeType` đang dùng (T002D).

## Checklist riêng — Local Development (`AI_PROFILE=local`):

\- Audio test 2-5 phút xử lý thành công bằng `WHISPER_MODEL=small` (hoặc `medium`), `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8`.

\- Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject đúng error, không treo máy/worker.

\- `SEPARATION_ENABLED=false` theo mặc định không bị coi là thiếu sót; nếu bật để test thì lỗi/confidence thấp không làm fail toàn bộ job.

\- Không ai dùng kết quả/thời gian chạy local để kết luận về chất lượng hoặc hiệu năng production.

## Checklist riêng — Production EC2 GPU (`AI_PROFILE=production-gpu`):

\- Container detect CUDA thành công khi startup (không rơi vào fail-fast T002C).

\- `WHISPER_MODEL=large-v3`, `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16` chạy ổn định.

\- `SEPARATION_ENABLED=true` chạy được trên GPU, best-effort như thiết kế gốc.

\- Audio dài 30-90 phút xử lý được qua chunking (T015), không bị giới hạn 2-5 phút như local.

## 10. Out of scope cho MVP

Không làm trong MVP nếu chưa được duyệt:

\- Real-time transcription khi meeting đang diễn ra.

\- Speaker identification bằng voiceprint/embedding để map chính xác user.

\- Fine-tune model.

\- RAG/semantic search trên transcript.

\- Tự động tạo minutes bằng LLM cloud.

\- Lưu transcript segment vào bảng riêng.

\- Cloud STT fallback.

\- Tự động sửa chính tả nâng cao bằng external AI.

\- UI review transcript quá phúc tạp.

## 11. Rủi ro kỹ thuật và hướng xử lý

## R1 — Hardware/GPU là rủi ro lớn nhất của toàn bộ plan

Rủi ro:

\- Laptop dev hiện tại (Intel Core i5-11300H, 4 core/8 thread, 16GB RAM, Intel Iris Xe Graphics — không có NVIDIA CUDA, không VRAM rời) không có khả năng chạy `faster-whisper large-v3` + `pyannote.audio` + `SpeechBrain SepFormer` ở mức production. Đây không phải rủi ro lý thuyết, mà là giới hạn phần cứng đã xác nhận (mục 2.5.1).

\- Nếu không tách rõ 2 profile (local vs production-gpu), team rất dễ rơi vào 1 trong 2 sai lầm: (a) ép laptop chạy `large-v3` rồi kết luận sai rằng pipeline "quá chậm/không khả thi", hoặc (b) chạy demo local rồi nhầm chất lượng đó là chất lượng sản phẩm cuối.

\- RAM 16GB phải chia sẻ giữa OS, IDE, Docker Desktop, Postgres + Redis + MinIO + Backend API + AI worker. Nếu chạy đồng thời Whisper (dù `small`/`medium`) + pyannote + SepFormer trên cùng máy, rất dễ chạm giới hạn RAM, gây swap nặng hoặc job bị kill.

Giải pháp:

\- Tách rõ Local Development Profile (model nhỏ, CPU, int8, audio ngắn 2-5 phút, không đo performance) và Production EC2 GPU Profile (`large-v3`, CUDA, float16) — mục 2.5.

\- Không cho phép code tự fallback âm thầm giữa 2 profile; nếu thiếu GPU mà profile yêu cầu GPU, fail fast (T002C).

\- Local profile có resource guard giới hạn duration (T002B) và cơ chế tự skip SepFormer khi thiếu RAM (T002E), để job không bao giờ treo vô thời hạn hay làm "đứng" máy dev.

\- Trước khi triển khai production thật, phải xác nhận EC2 instance (hoặc máy GPU khác) có GPU NVIDIA/CUDA và đủ VRAM (khuyến nghị ≥16GB để chạy đồng thời 3 model, có thể ít hơn nếu chấp nhận chạy tuần tự). Không giả định "đẩy lên EC2 là đủ mạnh" — EC2 CPU-only có cùng giới hạn như laptop hiện tại (không CUDA), chỉ khác RAM/CPU core có thể nhiều hơn; nó không giải quyết được vấn đề thiếu GPU.

\- **Tại thời điểm viết plan này, Production/High-Quality GPU mode CHƯA có xác nhận ngân sách, timeline, hoặc instance type cụ thể** (mục 2.5.3). Đây là rủi ro về tiến độ/phụ thuộc bên ngoài, không chỉ là rủi ro kỹ thuật: team không nên cam kết mốc thời gian cho Phase 6/7 đạt chất lượng production cho đến khi GPU thật được xác nhận. MVP capstone chỉ cam kết Local Development DoD (mục 12.1); mục 12.2 là kế hoạch tương lai.

## R2 — faster-whisper large-v3 nặng (chỉ áp dụng ở Production EC2 GPU Profile)

Rủi ro:

\- CPU xử lý chậm với recording dài (không áp dụng ở local, vì local không dùng `large-v3` — xem mục 2.5.2).

\- GPU thiếu VRAM có thể OOM nếu chạy đồng thời cả 3 model.

Giải pháp:

\- Hỗ trợ config `WHISPER_DEVICE=cpu|cuda` (mục 8).

\- Hỗ trợ `WHISPER_COMPUTE_TYPE=float16|int8`.

\- Limit `AI_WORKER_MAX_CONCURRENT_JOBS=1` cho cả 2 profile trong MVP.

\- Xử lý chunk cho audio dài (T015) — chủ yếu cần ở production, vì local đã giới hạn audio 2-5 phút.

## R3 — pyannote model cần preload đúng

Rủi ro:

\- Nếu model chưa được tải sẵn, worker sẽ cố tải internet và fail (vi phạm yêu cầu no-outbound-internet).

\- pyannote diarization model trên HuggingFace là gated model — cần xin quyền/license và tạo access token một lần ở máy có internet, KHÔNG phải ở runtime container.

Giải pháp:

\- Thực hiện T-HF-001 (assignee cụ thể accept license + tạo READ token + preload model) trước khi bắt đầu Phase 6. Preload model ở build stage hoặc model volume; access token chỉ dùng trong bước build/preload, không đưa vào image runtime.

\- Runtime dùng local path (`PYANNOTE_LOCAL_FILES_ONLY=true`).

\- Startup validate model tồn tại (T026), fail fast nếu thiếu, không tự tải.

## R4 — SepFormer là thành phần nặng nhất và không đảm bảo tách tốt mọi overlap

Rủi ro:

\- SepFormer là model nặng nhất trong 3 model AI của pipeline này — cả về RAM/VRAM lẫn rủi ro chất lượng, vì pretrained weights phổ biến thường train trên mixture tổng hợp (WSJ0-2mix/Libri2Mix), không hoàn toàn khớp với audio phòng họp thực tế (1 mic phòng, reverberation, SNR thay đổi).

\- Tách tiếng sai có thể làm gán nhằm speaker nếu không kiểm soát confidence.

\- Trên local profile, bật SepFormer có thể làm máy 16GB RAM quá tải khi chạy cùng Whisper + pyannote.

Giải pháp:

\- SepFormer chỉ best-effort, có thể tắt hoàn toàn qua `SEPARATION_ENABLED=false` (mặc định OFF ở local profile).

\- Có threshold confidence (`SEPARATION_ACCEPT_MIN_CONFIDENCE`).

\- **Không chắc thì lưu `speakerLabel = "unknown"` hoặc đánh dấu `lowConfidence = true`, `manualReviewRequired = true`** — không bao giờ ép gán speaker khi confidence thấp, kể cả khi SepFormer chạy "thành công" nhưng kết quả dưới ngưỡng.

\- Trên local profile, nếu bật để test, giới hạn chỉ chạy trên overlap segment rất ngắn, và có cơ chế tự skip khi thiếu RAM (T002E) thay vì để job crash hoặc treo máy.

## R5 — Transcript JSON quá lớn

Rủi ro:

\- Meeting dài làm speaker\_segments\_json lớn.

\- API GET transcript nặng.

Giải pháp:

\- GET transcript mặc định không include full segments.

\- Khi includeSegments=true, paginate segment array ở service layer.

\- Có thể giới hạn response size.

## R6 — No outbound internet khó đảm bảo nếu chỉ cấu hình app

Rủi ro:

\- Code không gọi internet nhưng container vẫn có đường ra ngoài.

Giải pháp:

\- Chặn ở network layer.

\- Docker internal network/security group/firewall.

\- Có security test thực tế (T035).

## 12. Definition of Done tổng thể

Definition of Done được tách theo 2 môi trường, vì năng lực phần cứng khác nhau (mục 2.5). Local Development KHÔNG cần đạt tiêu chí hiệu năng/chất lượng của Production.

## 12.1. Local Development — Definition of Done (validate flow trên laptop dev)

Local demo chỉ coi là done khi:

1. `AI_PROFILE=local` được set, worker đọc đúng `WHISPER_MODEL=small` (hoặc `medium`), `WHISPER_DEVICE=cpu`, `WHISPER_COMPUTE_TYPE=int8` từ `.env`, không hard-code (T002A).

2. API tạo transcription job trả `202` với audio test dài 2-5 phút.

3. Job được ghi vào `background_jobs`, BullMQ nhận job, AI worker consume và xử lý audio từ MinIO private bucket (container MinIO local).

4. faster-whisper (`small`/`medium`) chạy CPU thành công, có raw text hợp lý cho audio mẫu.

5. pyannote chạy được ở mức demo (có thể chậm, không yêu cầu nhanh) và sinh ra diarization/overlap output; nếu lỗi thì pipeline vẫn hoàn thành với `speakerLabel="unknown"` + warning rõ ràng, không fail cứng toàn bộ job.

6. SepFormer là optional best-effort: nếu tắt (`SEPARATION_ENABLED=false`, mặc định local) thì không chạy và không bị coi là thiếu sót; nếu bật để test thì lỗi/confidence thấp không làm fail toàn bộ job, chỉ đánh dấu `manualReviewRequired=true`.

7. Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject với error rõ ràng (T002B), không treo worker/máy.

8. Kết quả lưu đúng vào `transcripts` (`raw_text`, `speaker_segments_json`, `detected_speakers_json`, `confidence_score`), `background_jobs.status = completed`.

9. Không thêm bảng mới. Không dùng cloud STT/API bên ngoài. AI worker không có outbound internet runtime. Model weights preload/mounted sẵn — model nhỏ (`small`/`medium`) cũng phải preload, không tải runtime.

10. Log thể hiện rõ profile/model/device đang dùng (T002D), để không ai nhầm kết quả local là kết quả production.

**Local Development KHÔNG yêu cầu:** xử lý nhanh audio dài 30-60 phút, độ chính xác production-grade, SepFormer hoạt động tốt trên mọi overlap.

## 12.2. Production / High-Quality GPU mode — Definition of Done (future target, KHÔNG phải MVP commitment)

**Trạng thái:** mục này mô tả tiêu chí done khi profile `production-gpu` được triển khai thật trong tương lai. Tại thời điểm viết plan, EC2 GPU (hoặc máy GPU khác) **chưa có xác nhận ngân sách/timeline/instance type** (mục 2.5.3, mục 11 R1) — vì vậy mục 12.2 **không phải điều kiện để coi MVP capstone là done**. MVP capstone chỉ cần đạt mục 12.1. Mục 12.2 được giữ lại trong plan để có sẵn tiêu chí rõ ràng khi GPU thật được duyệt, tránh phải viết lại từ đầu.

Khi profile này được triển khai thật, ngoài toàn bộ tiêu chí ở mục 12.1 (đổi `AI_PROFILE=production-gpu`), coi là done khi:

1. Đã xác nhận máy GPU (EC2 hoặc khác) có GPU NVIDIA + CUDA hoạt động, container detect được GPU (không rơi vào fail-fast T002C).

2. `WHISPER_MODEL=large-v3`, `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16` chạy ổn định.

3. pyannote diarization + overlap detection chạy ở tốc độ chấp nhận được cho audio 30-90 phút (có chunking, T015).

4. SepFormer bật (`SEPARATION_ENABLED=true`) chạy trên GPU, best-effort như thiết kế gốc, không ép gán speaker sai.

5. Không có cloud STT/API bên ngoài, AI worker không có outbound internet runtime — kiểm chứng bằng T035 trên môi trường GPU thật, không chỉ trên local.

6. Có tài liệu vận hành ghi rõ yêu cầu GPU/VRAM tối thiểu, và ghi rõ trường hợp fallback CPU-only (mục 8.4) sẽ không đạt chất lượng/tốc độ mục tiêu.

7. Có unit/integration/smoke test pass trên cả 2 profile (T030-T035, T035A).

8. Có quickstart cho dev/agent chạy lại, với 2 ví dụ `.env` riêng cho local và production-gpu (T037).

9. **Caveat chất lượng STT tiếng Việt (bắt buộc ghi rõ, không tuỳ chọn):** kết quả STT tiếng Việt từ `large-v3` (hay bất kỳ model nào trong plan này) chỉ ở trạng thái `draft`, KHÔNG được coi là biên bản chính thức. Chất lượng phụ thuộc nhiều vào điều kiện thu âm thực tế: chất lượng mic, tiếng ồn nền, giọng/accent vùng miền, và mức độ overlapped speech. Vì vậy:

\- `transcripts.status` phải giữ ở `draft` sau khi AI xử lý xong (đúng mục 6.3), không tự động chuyển `approved`.

\- Host/Admin **bắt buộc phải review thủ công transcript trước khi publish minutes** hoặc coi nội dung là chính thức — không có cơ chế tự động publish minutes thẳng từ kết quả AI trong MVP hoặc production.

\- Tài liệu vận hành (T036/T037) phải nêu rõ caveat này cho người dùng cuối, để không ai hiểu nhầm transcript AI là biên bản đã được xác nhận.

**Feature chỉ coi là hoàn toàn done khi cả 12.1 và 12.2 đều đạt — hoặc khi team/stakeholder đồng thuận rằng giai đoạn hiện tại (capstone demo) chỉ cần đạt 12.1, và 12.2 là kế hoạch triển khai tương lai, ngoài phạm vi đánh giá trên laptop local.**
