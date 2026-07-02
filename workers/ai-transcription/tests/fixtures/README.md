## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-29 | Tạo fixture `sample-no-overlap.wav` cho T-DATA-001/T033 (M1 smoke test). | Toàn bộ file (mới) |
| 2026-06-30 | Tạo fixture `sample-domain-vocabulary.wav` cho T014B (benchmark small/medium/large-v3, kiểm tra nhận diện proper noun/thuật ngữ ngành). | Toàn bộ file (mới) |
| 2026-06-30 | Phát hiện lỗi: bản gốc `sample-domain-vocabulary.wav` sinh bằng giọng TTS **tiếng Anh** (`Microsoft Zira Desktop`, en-US) dù mô tả là podcast tiếng Việt — khi chạy benchmark T014B với `language=vi`, lỗi ngôn ngữ nguồn khiến model `medium` hallucinate nội dung tiếng Việt sai hoàn toàn thay vì phiên âm đúng. Thay fixture bằng audio sinh từ giọng `vi-VN-HoaiMyNeural` (Microsoft Edge neural TTS, qua thư viện `edge-tts`), nội dung tiếng Việt thật có chèn thuật ngữ tiếng Anh đúng như cách người Việt nói. | Toàn bộ file `sample-domain-vocabulary.wav` (thay nội dung), dòng mô tả bên dưới |
| 2026-07-01 | Tạo fixture `sample-overlap.wav` cho **T034** (M2 Independent Test) — 2 giọng tiếng Việt (`vi-VN-HoaiMyNeural` + `vi-VN-NamMinhNeural`) ghép timeline có khoảng lặng + 1 vùng chồng tiếng thật. Verify chạy thật pipeline M2: detectedSpeakers=2, segment overlap được đánh dấu `overlap=true`. | `sample-overlap.wav` (mới), dòng mô tả cuối |

# Test fixtures — AI Worker (offline transcription)

`sample-no-overlap.wav` — audio giả lập (~63s), sinh bằng Windows SAPI text-to-speech
(`Microsoft Zira Desktop`), **không phải recording thật** của công ty. Dùng làm input
cho smoke test M1 (T033) — xác nhận pipeline `transcribe_pipeline.py` chạy được
end-to-end và sinh transcript text không rỗng.

Đã verify bằng chạy thật qua `faster-whisper` (`tiny` model, CPU/int8): 14 segments,
confidence tổng hợp ~0.94.

`sample-domain-vocabulary.wav` — audio giả lập (~34s), sinh bằng giọng neural
tiếng Việt `vi-VN-HoaiMyNeural` (qua `edge-tts`, không phải recording thật của công
ty), nội dung mô phỏng 1 đoạn podcast tiếng Việt về business/marketing/design có
chèn các proper noun/thuật ngữ ngành bằng tiếng Anh: "Vietcetera", "podcast",
"marketing", "design", "creative", "business". Dùng cho **T014B** — so sánh chất
lượng nhận diện các từ này giữa `small`/`medium`/`large-v3` (profile
`local-quality-test`). Kết quả benchmark thật xem `quickstart.md` mục T014B.

`sample-overlap.wav` — audio giả lập (~13.7s), ghép từ 4 clip TTS tiếng Việt
(2 giọng `vi-VN-HoaiMyNeural` nữ + `vi-VN-NamMinhNeural` nam, qua `edge-tts`)
trên 1 timeline có cấu trúc: **Speaker A nói một mình** (0-3.9s) → khoảng lặng →
**vùng chồng tiếng A+B** (4.7-9.3s) → khoảng lặng → **Speaker B nói một mình**
(10-13.7s). Khoảng lặng giúp VAD tách segment để có cả segment 1-speaker (gán
được Speaker_1/Speaker_2) lẫn segment overlap. Dùng cho **T034** (overlap smoke
test / M2 Independent Test). Verify thật qua pipeline đầy đủ (whisper + pyannote
diarization + overlap detection): `detectedSpeakers=2`, segment vùng chồng tiếng
có `overlap=true` + `manualReviewRequired=true` (best-effort, chưa có SepFormer
M3). Cách dựng lại: xem `tasks.md` changelog 2026-07-01 (Wave 2).
