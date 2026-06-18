---
name: feat-sync-metadata-plan
description: Kế hoạch hiện thực REC-005 — ffprobe util + tích hợp finalizeFileToStopped (duration thật + metadata_json).
category: recording
---

# Implementation Plan: Media Metadata via ffprobe (REC-005)

- **Feature ID**: REC-005 · **Module**: recording (+ util/config) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md REC-005 (ffprobe.util async spawn, tích hợp finalizeFileToStopped, ENV FFPROBE_PATH, tests mock spawn). D-1..3 chốt. | Toàn bộ file |

---

## 1. Technical Context (đã xác minh — RECON spec §2)
- UC-119 internal → enrich trong `finalizeFileToStopped` (dùng chung REC-003 stop + REC-004 recover). KHÔNG endpoint/seed mới (D-1).
- ffprobe.exe có sẵn cùng `FFMPEG_PATH`. Async spawn (Promise) + timeout 10s (D-2).
- media_files.metadata_json (jsonb) hiện null → set `probe`; duration_seconds đổi nguồn (ffprobe → fallback wall-clock).
- env.validation §Q có FFMPEG_PATH → thêm FFPROBE_PATH. DATA-01: KHÔNG migration.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `recording/utils/ffprobe.util.ts` (probeMedia, parseFps, MediaProbe, FFPROBE_TIMEOUT_MS) |
| Sửa | `recording/services/recording-session.service.ts` (finalizeFileToStopped: probe + duration + metadata_json INSERT) |
| Sửa | `config/env.validation.ts` (+FFPROBE_PATH) + `.env.example` + `.env` local |
| Mới (test) | `recording/utils/ffprobe.util.spec.ts` |
| Sửa (test) | `recording/services/recording-session.service.spec.ts` (+probe OK/null; #23/#24/#25 xanh) |

## 3. ffprobe.util.ts
```ts
export interface MediaProbe { durationSeconds; width; height; videoCodec; fps; bitrate } // mọi field nullable
export const FFPROBE_TIMEOUT_MS = 10000;
export function parseFps(v): number|null  // 'num/den' → round(num/den,2); den=0/thiếu → null
export function probeMedia(filePath): Promise<MediaProbe|null>
  - spawn(FFPROBE_PATH||'ffprobe', ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath], {windowsHide:true})
  - gom stdout; timeout 10s → kill + resolve(null); 'error' → null; 'close'(code!=0) → null; else parseProbeJson(stdout).
  - parseProbeJson: JSON.parse (catch→null); videoStream=streams.find(codec_type==='video') (thiếu→null);
    durationSeconds=round(format.duration) nếu >0 else null; bitrate=video.bit_rate||format.bit_rate;
    fps=parseFps(avg_frame_rate); width/height/codec_name.
  - KHÔNG ném, KHÔNG log nội dung file.
```

## 4. finalizeFileToStopped (sửa)
```text
- wallClock = max(0, floor((stoppedAt-startedAt)/1000)-paused).
- probe = await probeMedia(storagePath).
- durationSeconds = (probe?.durationSeconds && >0) ? probe.durationSeconds : wallClock.
- metadata = { ...baseMetadata, ...(recovered?{recovered:true}:{}), ...(probe?{probe:{...probe,source:'ffprobe'}}:{}) }.
- INSERT media_files (+ metadata_json=$12=JSON.stringify(metadata)); duration_seconds=durationSeconds.
- UPDATE recording_sessions duration_seconds=durationSeconds (metadata_json session GIỮ logic cũ, KHÔNG probe).
```

## 5. ENV
Joi §Q: `FFPROBE_PATH: Joi.string().default('ffprobe')`. `.env.example` (FFPROBE_PATH=ffprobe) + `.env` local (D:\ffmpeg\bin\ffprobe.exe).

## 6. Tests (mock child_process.spawn, ≥80%)
- ffprobe.util.spec: spawn fake (EventEmitter + stdout) → JSON hợp lệ → parse đúng; exit!=0→null; timeout (fake timers)→null; JSON hỏng→null; không video stream→null; parseFps '25/1'→25 / '30000/1001'→29.97 / '0/0'→null. KHÔNG ném mọi ca.
- service.spec: finalize probe OK (mock probeMedia) → duration_seconds=ffprobe + metadata_json.probe(source ffprobe); probe null → fallback wall-clock + KHÔNG probe; merge giữ recovered/orphan_stop. #23/#24/#25 xanh.
  (mock: spyOn ffprobe.util.probeMedia trong service.spec để không phụ thuộc spawn thật.)

## 7. [NEEDS CLARIFICATION]
- Không còn (D-1..3 chốt).

## 8. DoD
```
[ ] ffprobe.util (probeMedia async + timeout + parseFps; best-effort null; không ném)
[ ] finalizeFileToStopped: probe→duration thật + metadata_json.probe; fallback wall-clock; merge không đè
[ ] ENV FFPROBE_PATH (+example +local)
[ ] tests ffprobe.util + service (probe OK/null/merge) + #23/#24/#25 xanh; coverage ≥80%
[ ] build/lint/jest/coverage/boot (started + reconcile, 0 DI) xanh
[ ] KHÔNG endpoint/seed/migration mới
```

> Trạng thái: CHỜ REVIEW sau implement. Chưa commit.
