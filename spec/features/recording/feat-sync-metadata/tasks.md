# Tasks: Media Metadata via ffprobe (REC-005)

- **Feature ID**: REC-005 · **Module**: recording
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> ffprobe best-effort (lỗi→fallback wall-clock). Tích hợp finalizeFileToStopped (stop + recover). KHÔNG endpoint/seed/migration. Test MOCK spawn.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md REC-005 (D-1..3: không endpoint, ffprobe.util async spawn, metadata lồng `probe`). | Toàn bộ file |

---

## 1. ffprobe util
**File**: `recording/utils/ffprobe.util.ts` (mới)
- [ ] `MediaProbe` interface (durationSeconds/width/height/videoCodec/fps/bitrate — nullable), `FFPROBE_TIMEOUT_MS=10000`.
- [ ] `parseFps(v)`: 'num/den'→round(num/den,2); den=0/thiếu→null.
- [ ] `probeMedia(filePath): Promise<MediaProbe|null>`: async spawn(FFPROBE_PATH) `-v quiet -print_format json -show_format -show_streams`; gom stdout; timeout→kill+null; error/exit!=0/parse-fail/không-video-stream→null; KHÔNG ném/không log file. **Ref**: FR-001..003/006/007.

## 2. Tích hợp finalize
**File**: `recording/services/recording-session.service.ts` (sửa)
- [ ] `finalizeFileToStopped`: `probe=await probeMedia(storagePath)`; `durationSeconds = probe?.durationSeconds>0 ? probe.durationSeconds : wallClock`.
- [ ] metadata merge `{...baseMetadata, ...(recovered?{recovered:true}:{}), ...(probe?{probe:{...probe,source:'ffprobe'}}:{})}`.
- [ ] INSERT media_files +cột `metadata_json`=$12; UPDATE session duration_seconds (metadata session giữ cũ). **Ref**: FR-004/005, NFR-001/006.

## 3. ENV
**File**: `config/env.validation.ts` + `.env.example` + `.env`
- [ ] Joi §Q `FFPROBE_PATH: Joi.string().default('ffprobe')`. example=ffprobe; local=D:\ffmpeg\bin\ffprobe.exe. **Ref**: FR-006, NFR-005.

## 4. Tests (mock, ≥80%)
**File**: `recording/utils/ffprobe.util.spec.ts` (mới) + `recording-session.service.spec.ts` (sửa)
- [ ] ffprobe.util: JSON hợp lệ→parse đúng; exit!=0→null; timeout→null; JSON hỏng→null; không video stream→null; parseFps 25/1, 30000/1001, 0/0; KHÔNG ném.
- [ ] service: finalize probe OK→duration ffprobe + metadata_json.probe; probe null→fallback wall-clock + KHÔNG probe; merge giữ recovered. #23/#24/#25 xanh.

## 5. Verify
- [ ] build · lint per-file · jest modules/recording + coverage · boot smoke (started + reconcile + 0 DI).

---
> Trạng thái: CHỜ REVIEW sau implement.
