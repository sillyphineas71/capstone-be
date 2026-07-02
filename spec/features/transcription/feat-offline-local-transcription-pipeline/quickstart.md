## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo quickstart.md ban đầu, tách từ `docs/Offline Meeting Transcription Pipeline Plan.md` (T036, T037, T038). | Toàn bộ file (mới) |
| 2026-06-30 | Cập nhật `WHISPER_MODEL` default trong ví dụ `.env` từ `small` sang `medium` (đồng bộ với `profile-config.ts`/`tasks.md`); thêm mục "T014B — Benchmark chất lượng small/medium/large-v3" với kết quả benchmark thật chạy trên máy dev (`small` vs `medium`; `large-v3` chưa chạy được do thiếu dung lượng đĩa); ghi nhận phát hiện fixture `sample-domain-vocabulary.wav` gốc bị sai ngôn ngữ TTS. | Step 2, Step 3, mục mới "T014B — Benchmark..." (sau Step 8) |
| 2026-06-30 | T007 hoàn thành thật: endpoint `GET /api/v1/background-jobs/:id` trước đây được tham chiếu trong Step 7 nhưng KHÔNG tồn tại (chỉ có service nội bộ, chưa có controller) — nay đã implement. Bổ sung mô tả response shape thật + authorization (owner/admin) vào Step 7. | Step 7 (mở rộng response shape + authz) |
| 2026-07-01 | Thêm mục "T-BENCH-001 — Đo RAM peak + thời gian thật" với bảng số đo thật (small-stt 836MB/24s, medium-stt 1756MB/70s, medium-diar 2583MB/155s) đo bằng harness `benchmark_resources.py`. Kết luận: giá trị đoán `AI_WORKER_MIN_FREE_RAM_MB=2048` thấp hơn peak thật path M2 → đã nâng lên 4096 (default profile `local` + `.env`/`.env.example`). | Mục mới "T-BENCH-001" (sau T014B) |

# Quickstart: TRANS-OFFLINE-001 Offline Local Meeting Transcription Pipeline

## Goal

Xác nhận luồng end-to-end của pipeline transcription chạy được trên laptop dev (Local Development Profile), KHÔNG phải đo hiệu năng production. Sau khi implement xong M1 (bắt buộc), một dev mới đọc file này phải chạy được pipeline từ đầu đến cuối.

> **Lưu ý quan trọng**: laptop dev (Intel Core i5-11300H, 16GB RAM, Intel Iris Xe — không CUDA) không phù hợp để chạy `large-v3`/đánh giá chất lượng production. Quickstart này chỉ dùng `small`/`medium` + CPU + `int8`, audio mẫu 2-5 phút.

## Prerequisites

- Docker + Docker Compose.
- Node.js LTS, npm/pnpm theo `package.json` của `capstone-be`.
- Python 3.x (cho AI Worker, có thể chạy trong container riêng — không cần cài trực tiếp trên máy host nếu dùng Docker).
- Đã hoàn thành `T-HF-001`: có quyền/license HuggingFace cho `pyannote/speaker-diarization-3.1` và `pyannote/segmentation-3.0`, đã preload model vào `models/pyannote/` (chỉ cần nếu muốn test M2; M1 thuần STT không cần bước này).
- Đã chuẩn bị audio test theo `T-DATA-001`: `workers/ai-transcription/tests/fixtures/sample-no-overlap.wav` và `sample-overlap.wav` (audio giả lập, KHÔNG phải audio thật của công ty).

## Step 1 — Start hạ tầng nền (Postgres/Redis/MinIO)

```bash
cd capstone-be
docker compose -f docker-compose.dev.yml up -d postgres redis minio
```

Xác nhận MinIO console truy cập được (cổng theo `docker-compose.dev.yml`, ví dụ `9002`), và bucket private (`MINIO_PRIVATE_BUCKET`, ví dụ `smrmpts-private-media`) đã được tạo.

## Step 2 — Cấu hình `.env` theo Local Development Profile

```env
AI_PROFILE=local

WHISPER_MODEL=medium
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

DIARIZATION_ENABLED=true
OVERLAP_DETECTION_ENABLED=true
SEPARATION_ENABLED=false

MAX_AUDIO_DURATION_LOCAL_SECONDS=300
AI_WORKER_MIN_FREE_RAM_MB=2048
AI_WORKER_MAX_CONCURRENT_JOBS=1

WHISPER_MODEL_PATH_SMALL=/models/faster-whisper-small
PYANNOTE_MODEL_PATH=/models/pyannote
PYANNOTE_LOCAL_FILES_ONLY=true
SEPFORMER_MODEL_PATH=/models/speechbrain-sepformer
SEPFORMER_LOCAL_FILES_ONLY=true

AI_WORKER_TEMP_DIR=/tmp/smrmpts-ai
AI_WORKER_NO_OUTBOUND_INTERNET=true

MINIO_ENDPOINT=http://minio:9000
MINIO_PRIVATE_BUCKET=smrmpts-private-media
MINIO_ACCESS_KEY=${SECRET}
MINIO_SECRET_KEY=${SECRET}
```

**Ví dụ Production EC2 GPU Profile (future, chỉ tham khảo — KHÔNG dùng được trên laptop dev hiện tại):**

```env
AI_PROFILE=production-gpu

WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16

DIARIZATION_ENABLED=true
OVERLAP_DETECTION_ENABLED=true
SEPARATION_ENABLED=true
```

## Step 3 — Mount model volume (preload, không tải runtime)

```bash
models/
├── faster-whisper-medium/     # bắt buộc cho local (default từ 2026-06-30, xem T014B)
├── faster-whisper-small/      # optional, nhanh hơn nhưng chất lượng thấp hơn — không còn default
├── pyannote/                  # cần T-HF-001 hoàn thành trước
└── speechbrain-sepformer/     # optional, chỉ cần nếu test M3
```

Không tải model ở bước này nếu container chưa có internet — model phải được tải sẵn ở máy có internet rồi copy vào `models/`.

## Step 4 — Start Backend API

```bash
npm install
npm run start:dev
```

## Step 5 — Start AI Worker

```bash
cd workers/ai-transcription
npm install
npm run start:dev
```

AI Worker sẽ consume queue `transcription` (BullMQ), không publish port public, chỉ kết nối Redis/PostgreSQL/MinIO nội bộ.

## Step 6 — Gọi API tạo transcription job

```bash
curl -X POST http://localhost:3000/api/v1/meetings/{meetingId}/transcription-jobs \
  -H "Authorization: Bearer <access-token-of-host-or-admin>" \
  -H "Content-Type: application/json" \
  -d '{
    "recordingSessionId": "<uuid-cua-recording-session-co-audio-mau>",
    "language": "vi-VN",
    "speakerMappingMode": "diarization_only",
    "forceRerun": false
  }'
```

Kỳ vọng: `202 Accepted` với `jobId`, `status="queued"`, `transcriptStatus="processing"`.

## Step 7 — Check background job status

```bash
curl http://localhost:3000/api/v1/background-jobs/{jobId} \
  -H "Authorization: Bearer <access-token>"
```

Poll cho tới khi `status="completed"` hoặc `status="failed"`.

Endpoint này (T007) trả về shape tối giản:

```json
{
  "success": true,
  "data": {
    "jobId": "uuid",
    "jobType": "transcription",
    "status": "running",
    "relatedEntityType": "meeting",
    "relatedEntityId": "uuid",
    "retryCount": 0,
    "scheduledAt": null,
    "startedAt": "2026-06-30T10:00:00.000Z",
    "completedAt": null,
    "errorMessage": null,
    "result": null,
    "outputFileId": null
  }
}
```

Khi `status="completed"`, `result` chứa `outputJson` của job (vd
`{ "transcriptId": "...", "status": "draft" }`) → dùng để gọi tiếp Step 8.
Khi `status="failed"`, `errorMessage` chứa error code ngắn từ worker.

**Authorization**: chỉ người tạo job (`requested_by`) hoặc role
`BUSINESS_ADMIN`/`SYSTEM_ADMIN` xem được — user khác nhận `403 PERMISSION_DENIED`,
job không tồn tại nhận `404 BACKGROUND_JOB_NOT_FOUND`. Endpoint chỉ dùng
JwtAuthGuard (không gắn permission node vì `background_job.*` chưa được seed —
authz xử lý trong service).

## Step 8 — Get transcript

```bash
curl "http://localhost:3000/api/v1/meetings/{meetingId}/transcript?includeSegments=true&page=1&limit=50" \
  -H "Authorization: Bearer <access-token>"
```

Kỳ vọng: `status="draft"`, `rawText`/`cleanedText` không rỗng, `segments[]` theo schema `contracts/ai-worker-result-schema.json`.

## T014B — Benchmark chất lượng small/medium/large-v3 (kết quả thật, 2026-06-30)

Chạy `transcribe_pipeline.py` trực tiếp (không qua BullMQ) trên
`workers/ai-transcription/tests/fixtures/sample-domain-vocabulary.wav`
(~34s, giọng `vi-VN-HoaiMyNeural`), `language=vi`, cùng
`--initial-prompt "Vietcetera, podcast, marketing, design, creative, business"`,
diarization/overlap tắt (giống profile `local-quality-test` nhưng chạy CLI trực
tiếp để đo nhanh, không qua queue).

| Model | Thời gian xử lý (CPU/int8) | confidenceScore | Nhận đúng "business" | Nhận đúng "marketing" | Nhận đúng "design"/"creative"/"branding" |
| :--- | ---: | ---: | :--- | :--- | :--- |
| `small` | ~16s | 0.608 | Sai cả 2 lần ("Bireners"/"birenars") | Đúng phần lớn, 1 lần tách sai thành "market tin" | Sai cả 3 ("đi đei", "Burundin", "criptTV"/"cripttv") |
| `medium` | ~38s | 0.628 | Đúng cả 2 lần | Đúng toàn bộ | Sai cả 3 ("Didai-Diret", "Burunding", "CryptiVe"/"cryptivé") |
| `large-v3` | Không chạy được | — | — | — | — |

**Kết luận**: `medium` ổn định hơn `small` rõ rệt cho từ vựng phổ biến
("business", "marketing", proper noun "Vietcetera") — xác nhận quyết định đổi
default sang `medium` (xem `tasks.md` changelog 2026-06-30) là đúng hướng. Tuy
nhiên **cả 2 model đều không nhận đúng các thuật ngữ ít phổ biến hơn** ("design",
"creative", "branding") dù đã có trong `initial_prompt` — `initial_prompt` của
faster-whisper chỉ là gợi ý ngữ cảnh nhẹ, không đảm bảo ép đúng từ. Đây là giới
hạn thật của approach hiện tại, ghi nhận lại để feature sau (custom vocabulary
mạnh hơn, hoặc post-processing fix từ điển) cân nhắc, không phải bug cần fix
ngay trong M1.

`large-v3` **không benchmark được** trên máy dev hiện tại do thiếu dung lượng đĩa
(cần thêm ~3GB, máy chỉ còn ~2.5GB trống). Cần chạy lại trên máy có đủ dung lượng
trước khi coi T014B là hoàn tất 100% — hiện tại chỉ có kết quả `small` vs `medium`.

**Lưu ý quan trọng phát hiện trong lúc benchmark**: fixture
`sample-domain-vocabulary.wav` bản gốc (tạo ngày 2026-06-30) bị sinh nhầm bằng
giọng TTS **tiếng Anh** dù mô tả là nội dung tiếng Việt — khi ép `language=vi` lên
audio tiếng Anh, model `medium` hallucinate ra cả đoạn tiếng Việt sai hoàn toàn
nội dung (kể cả bịa tên kênh YouTube không liên quan). Đã thay fixture bằng audio
sinh từ giọng `vi-VN-HoaiMyNeural` (`edge-tts`) — xem changelog
`tests/fixtures/README.md`. Bài học: phải verify ngôn ngữ thật của audio test
trước khi dùng để benchmark, không chỉ tin vào tên file/mô tả.

## T-BENCH-001 — Đo RAM peak + thời gian thật (2026-07-01)

Chạy bằng harness `workers/ai-transcription/python/benchmark_resources.py`
(spawn `transcribe_pipeline.py` + sample RSS process & children qua `psutil`,
lấy peak), trên `sample-no-overlap.wav`, máy dev (CPU, `int8`):

| Config | Peak RAM (MB) | Thời gian (s) |
| :--- | ---: | ---: |
| `small` + STT (không diarization) | 836 | 24 |
| `medium` + STT (không diarization) | 1756 | 70 |
| `medium` + diarization (M2, nặng nhất hiện có) | 2583 | 155 |

**Kết luận → cập nhật threshold:** giá trị đoán cũ `AI_WORKER_MIN_FREE_RAM_MB=2048`
**thấp hơn cả peak thật** của path M2 (2583 MB) — tức đoán SAI. Đã nâng default
profile `local` (và `.env`/`.env.example`) lên **4096 MB** (= peak × 1.5, làm tròn
512; đồng bộ với production profiles vốn đã 4096), để guard có headroom thật cho
cả SepFormer (M3) khi bật sau này.

> Lưu ý: combo `small + SepFormer` trong T-BENCH-001 gốc CHƯA đo được vì SepFormer
> (M3) chưa implement. Path nặng nhất hiện có là `medium + diarization` (M2) — đã
> đo. Khi M3 xong, cần đo lại combo có SepFormer và tinh chỉnh lại ngưỡng nếu cần.

## M2 — T-HF-001/T016 verify thật bằng model pyannote thật (2026-06-30)

`T-HF-001` đã hoàn thành thật trên máy dev: license HuggingFace cho
`pyannote/speaker-diarization-3.1`/`pyannote/segmentation-3.0` đã được accept,
access token READ đã tạo và set persistent (`HF_TOKEN`, User-scope env var —
KHÔNG commit vào `.env`/Git). Model đã preload vào
`workers/ai-transcription/models/pyannote/speaker-diarization-3.1/`.

**Config bắt buộc thêm (mới phát hiện, không có trong plan gốc)**: biến
`PYANNOTE_CACHE` phải trỏ tới cùng cache đã dùng để preload model nested
(`pyannote/segmentation-3.0`, `pyannote/wespeaker-voxceleb-resnet34-LM`) — xem
`.env`/`.env.example`. Thiếu biến này, `pyannote.audio` tìm model nested ở
cache riêng của nó (`~/.cache/torch/pyannote`, khác cache chuẩn
`huggingface_hub`) và báo lỗi như chưa preload dù model đã có trên máy.

Trong lúc verify `diarize()` chạy thật (không chỉ unit test mock), phát hiện
và sửa **6 lỗi tương thích môi trường thật** giữa `pyannote.audio==3.4.0`
(pin trong `requirements.txt`) và các bản `torch`/`torchaudio`/`huggingface_hub`/
`speechbrain` mới nhất hiện có trên máy dev (Python 3.14) — toàn bộ patch nằm
trong `workers/ai-transcription/python/diarization_runner.py`, có docstring
giải thích root cause cho từng patch; chi tiết đầy đủ xem changelog `tasks.md`
2026-06-30 (mục "T-HF-001 hoàn thành thật + T016 verify thật"). Tóm tắt:

1. `torchaudio.AudioMetaData` bị bỏ khỏi torchaudio mới → stub class.
2. `huggingface_hub.hf_hub_download` bỏ kwarg `use_auth_token` → wrap kwarg.
3. `torch>=2.6` đổi default `weights_only=True` → patch tạm `False` chỉ trong cửa sổ load model, khôi phục ngay sau.
4. `pyannote.audio` dùng `PYANNOTE_CACHE` riêng, không phải cache chuẩn HF.
5. Bug path-separator thật trong `speechbrain` (Windows) — vá lại đúng logic gốc.
6. `torchaudio.load`/`info` mới chỉ dùng `torchcodec` (cần FFmpeg DLL chưa cài) → patch dùng `soundfile`; bug riêng của bước này (quên forward `frame_offset`/`num_frames`) từng gây **Segmentation fault thật** trên 1 audio cụ thể — đã sửa.

Đã verify bằng `diarize()` thật + `transcribe_pipeline.py --diarization-enabled
true --overlap-detection-enabled true` trên cả 2 audio fixture
(`sample-no-overlap.wav`, `sample-domain-vocabulary.wav`): output đúng schema
(`speakerLabel`, `speakerSource="pyannote"`, `diarizationConfidence`,
`detectedSpeakers[]`), fallback `unknown`/`manualReviewRequired=true` đúng khi
dưới ngưỡng `SPEAKER_ASSIGN_MIN_CONFIDENCE`. Cả 2 fixture hiện tại chỉ có 1
speaker — `M2 Independent Test` đầy đủ (≥2 speaker + `overlap=true`) cần
fixture `sample-overlap.wav` (M2, chưa tạo — xem `tests/fixtures/README.md`).

**Follow-up chưa giải quyết**: 1 dòng cảnh báo "sending unauthenticated
requests to the HF Hub" xuất hiện dù `HF_HUB_OFFLINE=1` đã set — không chặn
chức năng nhưng cần xác nhận lại bằng network capture thật ở `T035` trước khi
coi yêu cầu "không outbound internet" (T025) đạt 100% cho M2.

## Main Scenarios (theo `spec.md`)

1. Tạo job thành công với audio 2-5 phút → `202`, sau đó `draft` transcript có text.
2. Thiếu `recordingSessionId` → `400 VALIDATION_ERROR`.
3. Recording session không thuộc meeting → `404 RECORDING_SESSION_NOT_FOUND`.
4. Job đang `processing` + `forceRerun=false` → `409 TRANSCRIPTION_JOB_ALREADY_RUNNING`.
5. Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` ở `AI_PROFILE=local` → job reject với `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE`, không treo worker.
6. `AI_PROFILE=production-gpu` mà container thiếu CUDA → worker fail fast `CUDA_NOT_AVAILABLE_FOR_PROFILE` (chỉ test được trên máy có/không giả lập GPU, không test được ý nghĩa thật trên laptop hiện tại).
7. Audio có overlap + pyannote phát hiện, `SEPARATION_ENABLED=false` → segment overlap vẫn đúng nhưng không gọi SepFormer.
8. Audio có overlap + `SEPARATION_ENABLED=true` (M3) + SepFormer confidence thấp → `speakerLabel="unknown"`, `lowConfidence=true`, `manualReviewRequired=true`, job vẫn `completed`.
9. User không phải Host/Admin của meeting gọi tạo job → `403 PERMISSION_DENIED`.
10. Participant hợp lệ gọi GET transcript → thành công; participant đó gọi PATCH sửa segment → bị từ chối (chỉ Host/Admin được sửa).

## Security Verification (T024/T025/T026/T027/T035)

> **Lưu ý kiến trúc (quan trọng)**: trong hiện thực hiện tại, AI worker KHÔNG
> phải container riêng — `TranscriptionWorkerProcessor` (NestJS) consume BullMQ
> rồi **spawn `transcription-job-runner.js` (Node) → Python pipeline** như
> child process. Vì vậy ranh giới mạng để cô lập là **container backend** (nơi
> Python chạy), không phải 1 service "ai-worker" tách rời. Plan gốc (T025) giả
> định AI worker là service riêng — chênh lệch này được ghi nhận ở `tasks.md`.

### Tầng 1 — Code-level controls (VERIFY ĐƯỢC NGAY, chạy trong CI)

| Control | Cơ chế | Test tự động |
| :--- | :--- | :--- |
| Không cloud STT/API ngoài (T024) | `assertLocalProviderOnly()` chỉ nhận `local_faster_whisper`; không lib cloud STT | `profile-config.spec.ts`, `python/no_external_stt_test.py` |
| Không egress HTTP trong pipeline Python (T025) | Scan tĩnh — không `openai/google.cloud/boto3/httpx/requests/socket...` | `python/no_external_stt_test.py` |
| pyannote offline (T025) | `PYANNOTE_LOCAL_FILES_ONLY=true` (throw nếu false) + ép `HF_HUB_OFFLINE=1` trước khi import pyannote | `python/no_external_stt_test.py`, `diarization_runner_test.py` |
| Không runtime download (T026) | `validateModelsAvailable()` fail-fast nếu model chưa preload | `model-validation.spec.ts` |
| Không log secret/token/raw transcript (T027) | Log chỉ jobId/profile/status | `logging-policy.spec.ts`, `minio-audio-loader.spec.ts` |

Chạy nhanh toàn bộ kiểm tra code-level:

```bash
# AI worker (Python)
python -m pytest python/no_external_stt_test.py -v
# AI worker (Node)
npx jest src/model-validation.spec.ts src/logging-policy.spec.ts src/profile-config.spec.ts
```

### Tầng 2 — Container network isolation (infra target — cần containerize backend)

Khi backend (chứa Python pipeline) được đóng gói container, đặt nó vào Docker
network `internal: true` (không route ra ngoài), chỉ cho tới Redis/PostgreSQL/MinIO
nội bộ. Khi đó verify thật:

```bash
docker exec -it <backend-container> sh
curl -m 5 https://huggingface.co   # PHẢI fail/timeout (no outbound internet)
curl -m 5 http://minio:9000        # PHẢI pass (internal network)
```

**Trạng thái hiện tại**: backend + AI worker CHƯA được dockerize (chạy bằng
`npm run start:dev` trên host), nên bước curl-từ-container CHƯA chạy được. Bù lại,
guard offline tầng code ĐÃ được xác minh hoạt động thật: trong lúc debug M2, khi
thiếu `PYANNOTE_CACHE`, pyannote báo `OfflineModeIsEnabled`/`LocalEntryNotFoundError`
thay vì gọi mạng — chứng tỏ `HF_HUB_OFFLINE=1` chặn egress đúng. **Follow-up**: 1
dòng cảnh báo "sending unauthenticated requests to the HF Hub" cần xác nhận bằng
network capture khi container hoá (xem `tasks.md` changelog T-HF-001).

### Posture offline khi deploy thật (production)

Đặt trong env của môi trường thật:

```env
TRANSCRIPTION_PROVIDER=local_faster_whisper
WHISPER_LOCAL_FILES_ONLY=true      # dev có thể để false để cache lần đầu
PYANNOTE_LOCAL_FILES_ONLY=true
WHISPER_MODEL_PATH=/models/faster-whisper-medium   # preload, không tải runtime
PYANNOTE_MODEL_PATH=/models/pyannote/speaker-diarization-3.1
```

## Demo Acceptance Checklist

### Checklist chung (mọi profile)

- [ ] Recording/audio nằm trong MinIO private bucket.
- [ ] User tạo transcription job nhận `202`.
- [ ] `background_jobs` có row `queued`/`running`/`completed` (hoặc `failed`).
- [ ] BullMQ có job trên queue `transcription`.
- [ ] AI worker xử lý offline (không network call ra ngoài trong lúc chạy).
- [ ] `transcripts` có `raw_text`, `cleaned_text`, `speaker_segments_json`.
- [ ] Overlap segment không chắc được đánh dấu `unknown`/`manualReviewRequired`.
- [ ] AI worker không có outbound internet (T035).
- [ ] Không có cloud STT/API call nào trong code path.
- [ ] Log thể hiện rõ `aiProfile`/`whisperModel`/`device`/`computeType` đang dùng.

### Checklist riêng — Local Development (`AI_PROFILE=local`)

- [ ] Audio test 2-5 phút xử lý thành công bằng `small`/`medium` + CPU + `int8`.
- [ ] Audio dài hơn `MAX_AUDIO_DURATION_LOCAL_SECONDS` bị reject đúng error, không treo máy/worker.
- [ ] `SEPARATION_ENABLED=false` theo mặc định không bị coi là thiếu sót.
- [ ] Không ai dùng kết quả/thời gian chạy local để kết luận chất lượng/hiệu năng production.

### Checklist riêng — Production / High-Quality GPU (future, KHÔNG phải MVP gate)

- [ ] Container detect CUDA thành công khi startup.
- [ ] `large-v3` + `cuda` + `float16` chạy ổn định.
- [ ] `SEPARATION_ENABLED=true` chạy được trên GPU.
- [ ] Audio 30-90 phút xử lý được qua chunking.

## Troubleshooting nhanh

| Vấn đề | Nguyên nhân thường gặp | Cách kiểm tra |
|---|---|---|
| Job treo `processing` mãi | AI Worker crash giữa lúc xử lý, chưa có retry/cleanup | Xem log AI Worker, kiểm tra T009/T032 |
| `AUDIO_TOO_LONG_FOR_LOCAL_PROFILE` dù audio ngắn | `MAX_AUDIO_DURATION_LOCAL_SECONDS` cấu hình sai trong `.env` | Kiểm tra mục 8.2 trong `docs/Offline Meeting Transcription Pipeline Plan.md` |
| pyannote lỗi load model | `T-HF-001` chưa hoàn thành, model chưa preload đúng path | Kiểm tra `models/pyannote/`, `PYANNOTE_MODEL_PATH` |
| Worker không tải được audio từ MinIO | `T-STORAGE-001` chưa implement driver MinIO thật trong `StorageService` | Kiểm tra `src/modules/storage/storage.service.ts` |
| RAM máy dev bị đầy khi chạy | SepFormer bật cùng lúc với Whisper + pyannote trên 16GB RAM | Set `SEPARATION_ENABLED=false`, kiểm tra T002E resource guard |
