## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-03 | **Đổi tên `spec.md` → `research.md`.** File này KHÔNG còn là spec chính thức — cấu trúc gốc (RECON tự do + mục "NEEDS CLARIFICATION" + quyết định D-1..D-8 xen giữa) không khớp `.specify/templates/spec-template.md` (8 mục chuẩn: Context&Goal / Actor&Roles / Functional Requirements / NFR / Data Model / Error Handling / Acceptance Criteria / Out of Scope) — đúng convention cũ của repo (`research.md` đi kèm `spec.md`, xem các feature account/meeting/live-meeting). Giữ nguyên toàn bộ nội dung bên dưới làm **nguồn RECON + lịch sử quyết định** — `spec.md` mới (viết lại đúng chuẩn template) trích dẫn ngược lại file này khi cần dẫn chứng file:line. Không xoá thông tin nào. | Toàn bộ file (đổi vai trò, không đổi nội dung cũ) |
| 2026-08-03 | Tạo spec ban đầu từ đề xuất của Thiếu Chủ (PC cố định trong phòng họp + mic hội nghị USB + ghi âm bằng `MediaRecorder` ngay trong app, thay cho điện thoại Host + app ghi âm riêng). RECON đối chiếu code thật (`audio-upload`, GIAI ĐOẠN 3 marker). Còn nhiều [NEEDS CLARIFICATION] — spec DRAFT, chưa plan/tasks/code. | Toàn bộ file (mới) |
| 2026-08-03 | **CHỐT TOÀN BỘ NC-1..7 → D-1..D-8** sau phiên thảo luận với Thiếu Chủ. Thay mục 6 (danh sách câu hỏi mở) bằng bảng quyết định chính thức + mục 6.1 (3 rủi ro kỹ thuật đã biết, cần smoke test). Phát hiện mới khi RECON phục vụ thảo luận: (1) `uploadAudioTrack()` KHÔNG tái dùng được cho chunk (3 chốt chặn cứng, gồm 409 ở chunk thứ 2); (2) `assertHostOrAdmin` khiến mọi tài khoản trạm chung bị 403 — quyết định cho Host tự đăng nhập; (3) `rooms.has_microphone` đã tồn tại VÀ đã trả về FE sẵn ⇒ không cần migration cho việc đánh dấu phòng có trạm; (4) đọc code xác nhận anchor `tagSource='post'` = `recordingSession.startedAt` ⇒ endpoint mới ghi ngược công thức là khớp tuyệt đối, không sửa `SpeakerMappingService`. Cập nhật FR-003 theo D-4/D-5, thêm FR-005/006. Spec sẵn sàng viết plan.md. | Changelog, mục 5 (FR), mục 6 (viết lại toàn bộ), mục 6.1 (mới), mục 7, trạng thái cuối |
| 2026-08-03 | **Chốt NC-1 (một phần)**: Thiếu Chủ chọn hướng "vẫn giữ live-tagging cho phòng trạm cố định, nhưng đơn giản hoá — không qua marker". Bổ sung mục 3.1 làm rõ 3 tầng (diarization / gán sau họp GIAI ĐOẠN 2 / gán trong họp GIAI ĐOẠN 3) sau khi phát hiện Thiếu Chủ hiểu nhầm "bỏ marker" = "bỏ luôn việc tìm người nói". Bổ sung mục 4.1 — hướng kiến trúc mới: tái dùng NGUYÊN VẸN anchor `recording_sessions.started_at` của GIAI ĐOẠN 2 (không phải marker của GIAI ĐOẠN 3) vì với trạm cố định, upload xảy ra ngay sau khi dừng ghi nên `started_at` có sẵn sớm — chỉ cần 1 endpoint mới nhận offset do FE tính sẵn, không cần `tagSource` mới, không cần đụng `SpeakerMappingService`. Cập nhật NC-4 phản ánh hướng này; NC-2/3/5/6/7 vẫn mở. | Mục 3 (đổi tên 3→3.0, thêm 3.1), mục 4 (thêm 4.1), mục 6 NC-4 |

> File này là tài liệu documentation-first, **chưa code**. Nguồn đề xuất gốc: tin nhắn của Thiếu Chủ ngày 2026-08-03 (5 mục: ý tưởng, so sánh phương án điện thoại, chi phí đầu tư, rủi ro/mở, bước tiếp theo). Đối chiếu code thật: `src/modules/recording/controllers/recording-session.controller.ts`, `src/modules/recording/services/recording-session.service.ts`, `src/modules/transcription/live-speaker-tagging.controller.ts`, `src/modules/transcription/speaker-mapping.service.ts`, `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md`, `FE_SmarTracking/src/components/transcription/AudioUploader.jsx`.

---

# Feature Specification: Ghi âm tại trạm cố định trong phòng họp qua trình duyệt (Fixed-Station Browser Recording)

- **Feature ID**: REC-006 (chưa có mã UC chính thức — đề xuất mới, chưa nằm trong Feature Table/API Contract hiện có)
- **Feature Name**: PC cố định trong phòng họp + mic hội nghị USB, ghi âm trực tiếp bằng `MediaRecorder` của trình duyệt trong chính app cuộc họp, upload lên hệ thống dùng transcription pipeline có sẵn
- **Module / Domain**: `recording` (thu âm), điểm nối `transcription` (đầu vào pipeline) — **không đụng** module `transcription`/`meetings` cho phần thu âm
- **Created Date**: 2026-08-03
- **Status**: Draft (RECON xong — còn nhiều [NEEDS CLARIFICATION], **chưa có quyết định nào được chốt**)
- **Source Documents**:
  - Đề xuất gốc của Thiếu Chủ (chat 2026-08-03) — ý tưởng PC cố định + mic hội nghị + `MediaRecorder` thay điện thoại
  - `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (kế hoạch tổng ghi âm + gán danh tính, quyết định #1/#7, GIAI ĐOẠN 0→4)
  - `spec/features/transcription/feat-speaker-tagging-live/spec.md` (GIAI ĐOẠN 3 — cơ chế marker hiện tại mà đề xuất này muốn thay thế)
  - `src/modules/recording/controllers/recording-session.controller.ts:126-150` (`audio-upload`, endpoint tái dùng)
  - `src/modules/recording/services/recording-session.service.ts:49-58,812-942` (danh sách định dạng hỗ trợ, luồng lưu file)
  - `FE_SmarTracking/src/components/transcription/AudioUploader.jsx` (UI upload hiện tại — kéo-thả file đã ghi sẵn)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hiện tại, việc đưa audio vào hệ thống hoàn toàn thủ công: Host (hoặc ai đó) ghi âm bằng app riêng trên điện thoại/máy ghi âm trong lúc họp, rồi **sau khi họp xong** mới kéo-thả file vào `AudioUploader.jsx` (`FE_SmarTracking/src/components/transcription/AudioUploader.jsx`) để gọi `POST /meetings/:id/recording-sessions/audio-upload`. Đồng thời, **GIAI ĐOẠN 3** (`feat-speaker-tagging-live`, code xong 2026-08-03 — 19 test mới, 111 test module `transcription` pass) vừa build xong cơ chế: Host bấm nút "Bắt đầu ghi âm" TRONG app tại đúng lúc bấm ghi trên thiết bị ngoài, server đóng dấu mốc t=0 vào `meeting_events` (`event_type='recording_start_marker'`) để sau này quy chiếu các lượt gán tên trực tiếp trong họp về đúng giây trong file audio — vì hai thiết bị (app cuộc họp và máy ghi âm) tách rời, không có cách nào khác để đồng bộ đồng hồ.

Đề xuất của Thiếu Chủ loại bỏ nguyên nhân gốc của vấn đề đó: nếu ghi âm diễn ra **trong chính trình duyệt** (qua `MediaRecorder` API) trên một PC cố định đặt trong phòng, thì việc ghi âm và việc bấm "ai đang nói" xảy ra trong **cùng một phiên trình duyệt liên tục** — app tự biết chính xác đang ở giây thứ mấy của bản ghi, không cần đồng bộ hai mốc thời gian qua `meeting_events` nữa.

### 1.2 Mục tiêu

- Xác nhận tính khả thi kỹ thuật của đề xuất đối chiếu với code/hạ tầng thật hiện có (không phải hỏi lại từ đầu — tận dụng tối đa).
- Vạch rõ phần **BE cần đổi** (nếu có) và phần **FE cần làm mới** (khác hẳn `AudioUploader.jsx` hiện tại — chuyển từ "chọn file đã ghi sẵn" sang "bấm Ghi/Dừng, ghi trực tiếp trong tab").
- Làm rõ **quan hệ với GIAI ĐOẠN 3** (marker mechanism vừa code xong hôm nay) — giữ lại, thay thế, hay chạy song song.
- Liệt kê đầy đủ các điểm còn mơ hồ cần Thiếu Chủ chốt trước khi viết plan/tasks/code.

### 1.3 Giá trị mang lại

- Giảm 1 bước thao tác thủ công (không cần Host tự tay upload file sau họp — có thể tự động hoá tiếp ở phase sau).
- Loại bỏ toàn bộ lớp phức tạp "đồng bộ 2 mốc thời gian qua `meeting_events`" cho các phòng có trạm cố định — vì ghi âm và gán tên cùng một đồng hồ trình duyệt.
- Chất lượng âm thanh tốt hơn (mic hội nghị chuyên dụng vs mic điện thoại).
- Dữ liệu không nằm tạm trên thiết bị cá nhân của Host.

### 1.4 Out-of-scope (rõ ràng ngay từ đầu)

- **Không** đổi database schema/thêm bảng — `recording_sessions`/`media_files` hiện có đã đủ chứa audio upload từ nguồn `manual_upload` (xem RECON mục 2). Nếu phát sinh nhu cầu schema mới, đó là tín hiệu thiết kế sai hướng.
- **Không** tự động quyết định số phận GIAI ĐOẠN 3 (marker mechanism) — đây là quyết định nghiệp vụ/rollout của Thiếu Chủ, xem mục 5 (Quan hệ với GIAI ĐOẠN 3).
- **Không** thiết kế phần cứng (loại mic cụ thể, vị trí đặt) — nằm ngoài phạm vi spec backend/frontend này.
- **Không** làm real-time streaming audio lên server trong lúc họp (WebSocket/RTC) — MVP vẫn là "ghi xong trong trình duyệt → upload file" giống cơ chế hiện có, chỉ khác nguồn tạo ra file.
- **Không** làm lại giao diện AI Summarize/transcript review — chỉ chạm vào bước "audio vào hệ thống bằng cách nào".

---

## 2. RECON — Đối chiếu code thật (file:line)

| Hạng mục | Phát hiện |
|---|---|
| Endpoint audio-upload đã có | [recording-session.controller.ts:126-150](../../../../src/modules/recording/controllers/recording-session.controller.ts): `POST /meetings/:meetingId/recording-sessions/audio-upload`, permission `transcript.create`, `FileInterceptor('file')`, giới hạn `AUDIO_UPLOAD_MAX_BYTES` (env `STORAGE_MAX_FILE_SIZE`, mặc định 100MB, hiện `.env` đã set `524288000` = 500MB theo GA-04). |
| Định dạng chấp nhận | [recording-session.service.ts:49-58](../../../../src/modules/recording/services/recording-session.service.ts): `SUPPORTED_AUDIO_EXTENSIONS = ['.wav','.mp3','.m4a','.mp4','.aac','.flac','.ogg','.webm']` — validate bằng **đuôi file** (`path.extname(file.originalname)`), không phải MIME type. **`.webm` đã có sẵn trong danh sách** — đúng định dạng mặc định `MediaRecorder` xuất ra trên Chrome/Edge (`audio/webm;codecs=opus`). ⇒ Về lý thuyết, **không cần sửa BE** cho việc chấp nhận file, miễn FE đặt tên file upload có đuôi `.webm`. |
| Luồng lưu file | [recording-session.service.ts:812-942](../../../../src/modules/recording/services/recording-session.service.ts) `uploadAudioForTranscription()`: validate meeting tồn tại + Host/Admin → validate đuôi file → tính sha256 checksum → `probeUploadedAudioDuration()` (ffmpeg/ffprobe — đã xử lý nhiều định dạng, không riêng wav/mp3/m4a) → lưu qua `StorageService.saveFile()` → transaction tạo `recording_sessions` (status `stopped`, `sourceType='manual_upload'`) + `media_files`. **Không có bước nào giả định nguồn file là "ghi sẵn từ điện thoại"** — hoàn toàn trung lập với nguồn gốc file. |
| FE hiện tại | [AudioUploader.jsx](../../../../../FE_SmarTracking/src/components/transcription/AudioUploader.jsx): kéo-thả/chọn file **đã có sẵn trên máy** (`<input type="file">`), gọi `uploadAudio()` → `createTranscriptionJob()`. **Không có** `MediaRecorder`/`getUserMedia` ở đây. |
| `MediaRecorder`/`getUserMedia` trong FE | Đã dùng cho **video, không audio** ở `FaceRegistration.jsx` (webcam đăng ký khuôn mặt) và `InMeetingRoom.jsx:476,503` (`getUserMedia({video:true, audio:false})`, phục vụ check-in khuôn mặt trong họp — khác mục đích). ⇒ Team đã có kinh nghiệm dùng permission camera/mic trong trình duyệt, nhưng **chưa từng dùng cho ghi âm dài + upload Blob lớn**. |
| GIAI ĐOẠN 3 (marker) — trạng thái thật | [feat-speaker-tagging-live/spec.md](../../transcription/feat-speaker-tagging-live/spec.md) + `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục 7: **CODE XONG 2026-08-03** (hôm nay) — 3 endpoint (`POST recording/start-marker`, `POST recording/live-speaker-tag`, `POST recording/start-marker/manual`), `SpeakerMappingService` mở rộng, `MeetingEventType.RECORDING_START_MARKER`, 19 test mới, 111 test module pass, không regression. **FE CHƯA nối** (chỉ mới xong tài liệu bàn giao API cho FE, GIAI ĐOẠN 4 — chưa có UI thật gọi 3 endpoint này). |
| Vì sao GIAI ĐOẠN 3 tồn tại (bài toán gốc) | `feat-speaker-tagging-live/spec.md` mục 1.1: `recording_sessions` (mốc neo GIAI ĐOẠN 2 dùng cho `tagSource='post'`) **chỉ được tạo lúc Host UPLOAD file** — không tồn tại lúc họp đang diễn ra. Với ghi âm bằng điện thoại/máy ghi âm rời (2 thiết bị, 2 đồng hồ), server không có cách nào biết "giây thứ mấy trong file audio đang được ghi lúc Host bấm gán tên" ⇒ phải neo qua `meeting_events.recording_start_marker` riêng. **Nếu ghi âm diễn ra ngay trong tab trình duyệt của app**, ứng dụng có thể tự tính offset = `Date.now() - recordingStartTimestamp` tại đúng lúc bấm gán tên — **không cần marker `meeting_events` nữa cho trường hợp này**, vì cùng một tiến trình JS giữ cả 2 mốc. |
| `createAudioSession` + `audio-tracks` (hạ tầng có sẵn khác) | [recording-session.controller.ts:156-178,205-230](../../../../src/modules/recording/controllers/recording-session.controller.ts): cơ chế "tạo session rỗng rồi nhiều lần POST file con vào cùng session" đã tồn tại (ban đầu cho multi-participant channel_zone), permission `recording.upload_track` — **có thể tái dùng làm cơ chế chunk-upload** cho ghi âm dài (xem mục 6, [NC-3]) thay vì giữ 1 Blob khổng lồ trong RAM tab đến hết họp. |
| Giới hạn thời lượng pipeline AI | `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục 5: RTF ~1.73× (họp 60' → ~1h44 xử lý CPU, đo trên rig cá nhân qua Tailscale — xem bộ nhớ dự án). Không đổi bởi feature này, chỉ nêu để nhắc: ghi âm dài hơn ⇒ xử lý AI lâu hơn tương ứng, không phải rủi ro riêng của feature này. |

### 2.1 Kết luận RECON

Về mặt **backend upload endpoint**, đề xuất của Thiếu Chủ khả thi gần như "cắm là chạy" — endpoint `audio-upload` đã trung lập với nguồn gốc file và đã hỗ trợ sẵn `.webm`. Phần việc thật sự nằm ở **FE (mới hoàn toàn)** + một vài quyết định nghiệp vụ về **cách ghi dài hạn an toàn** (chunk hay giữ nguyên 1 file) và **số phận GIAI ĐOẠN 3**.

---

## 3. Quan hệ với GIAI ĐOẠN 3 (marker mechanism) — quyết định cần Thiếu Chủ chốt

GIAI ĐOẠN 3 vừa code xong **cùng ngày hôm nay**, đã test kỹ (19 test mới, 111 test pass), nhưng FE chưa nối. Đề xuất PC cố định làm cho cơ chế marker **không cần thiết** cho phòng có trạm cố định — nhưng:

- Việc lắp PC + mic hội nghị cho **tất cả phòng họp** cần đầu tư phần cứng, khó làm ngay lập tức toàn bộ (đúng như mục 3 đề xuất gốc: "cần đầu tư cả phần cứng").
- Trong lúc rollout phần cứng dần dần, **những phòng chưa có trạm cố định** vẫn cần cách ghi âm nào đó (điện thoại + upload sau) — nếu vẫn muốn gán tên trực tiếp trong lúc họp cho các phòng đó, vẫn cần GIAI ĐOẠN 3.

**[NEEDS CLARIFICATION — NC-1]**: Chọn 1 trong 3 hướng:
1. **Giữ song song** — GIAI ĐOẠN 3 (marker) tiếp tục dùng cho phòng chưa có trạm cố định; feature mới (REC-006) dùng cho phòng đã có trạm, gán tên trực tiếp qua offset nội bộ trình duyệt (không gọi 3 endpoint marker). Không tốn công dọn code, nhưng có 2 luồng gán-tên-trực-tiếp song song cần FE phân biệt theo phòng.
2. **Deprecate GIAI ĐOẠN 3 ngay** — chỉ triển khai trạm cố định, không đầu tư FE cho marker nữa (tiết kiệm công FE, nhưng "phí" phần BE vừa test kỹ hôm nay, và mất khả năng gán trực tiếp cho phòng chưa có trạm).
3. **Không quyết định vội** — làm REC-006 trước ở dạng thử nghiệm (1 phòng pilot), giữ nguyên GIAI ĐOẠN 3 y như hiện tại (đã xong, không đụng vào), quyết định dứt điểm sau khi có dữ liệu thực tế từ phòng pilot.

*Đề xuất của agent (chỉ là đề xuất, chưa chốt): hướng 3 — rủi ro thấp nhất, không huỷ công đã test hôm nay, không chặn tiến độ REC-006.*

### 3.1 [CHỐT — 2026-08-03] Làm rõ phạm vi: "bỏ marker" ≠ "bỏ gán tên người nói"

Thiếu Chủ chọn: **giữ khả năng gán tên TRONG LÚC họp cho phòng trạm cố định, nhưng ở dạng đơn giản hoá — không qua cơ chế marker của GIAI ĐOẠN 3.** Trước khi ghi nhận, cần tách rõ 3 tầng đang dễ bị gộp nhầm làm một (câu hỏi Thiếu Chủ đặt ra đã lộ đúng chỗ mơ hồ này):

| Tầng | Việc gì | Có bị ảnh hưởng bởi đề xuất trạm cố định không? |
|---|---|---|
| 1. Diarization (pyannote) | Tự động gom giọng thành `Speaker_1`, `Speaker_2`... — không biết tên thật | **Không** — luôn chạy, độc lập hoàn toàn với cách ghi âm |
| 2. Gán tên SAU họp (GIAI ĐOẠN 2, đã xong 2026-08-02) | Host xem transcript, chọn tên thật cho từng cụm `Speaker_N` | **Không** — độc lập với cách ghi âm, luôn hoạt động, đây là cơ chế **giải quyết bài toán "ai đang nói"** một cách chắc chắn nhất (xem lại được, sửa được) |
| 3. Gán tên TRONG LÚC họp (GIAI ĐOẠN 3) | Tiện ích thêm — Host bấm gán ngay lúc nghe, đỡ phải nhớ lại ở Tầng 2 | **Có** — chỉ phần **cơ chế đồng bộ đồng hồ hai thiết bị** (marker `meeting_events`) trở nên thừa với trạm cố định, KHÔNG PHẢI bản thân việc gán tên trở nên thừa |

⇒ Quyết định của Thiếu Chủ **không loại bỏ khả năng tìm người nói** — Tầng 2 (GIAI ĐOẠN 2) vẫn nguyên vẹn, luôn là lưới an toàn cuối cùng bất kể trạm cố định có hoạt động hay không. Quyết định chỉ thu hẹp phạm vi ở Tầng 3: **có** vẫn làm gán-tên-trong-lúc-họp cho phòng trạm cố định, **nhưng không** dùng lại 3 endpoint GA-30/32/35 (marker) — thay bằng cơ chế mới đơn giản hơn (mục 4.1). Với phòng CHƯA có trạm cố định: theo hướng 2 ở NC-1 (không đầu tư FE cho marker), các phòng đó tạm thời **chỉ có Tầng 2** (gán sau họp) — vẫn đủ để trả lời "ai đang nói", chỉ là Host phải nhớ lại/nghe lại thay vì gán ngay lúc đó. Code BE của GIAI ĐOẠN 3 (GA-30/32/35, đã test) **giữ nguyên trong repo, không xoá** — chỉ tạm thời không có FE gọi tới, có thể tái kích hoạt sau nếu cần.

---

## 4. Luồng đề xuất (nếu làm REC-006)

```text
TRONG CUỘC HỌP (trên PC cố định, trình duyệt đã mở app + xin quyền mic 1 lần)
  Host/người phụ trách bấm "Bắt đầu ghi" trong app
    → FE: getUserMedia({audio:true}) → MediaRecorder.start(timeslice?)
    → FE lưu recordingStartTimestamp = performance.now()/Date.now() cục bộ (KHÔNG gọi BE)
  (tuỳ chọn) Host bấm gán "người này đang nói" bất kỳ lúc nào
    → FE tự tính offsetSeconds = (Date.now() - recordingStartTimestamp) / 1000
    → [NC-4] gọi API nào để lưu? (endpoint GIAI ĐOẠN 3 GA-32 tái dùng với offset đã tính sẵn,
      hay endpoint mới nhận thẳng offsetSeconds thay vì server tự tính qua marker?)
  Host bấm "Dừng ghi"
    → MediaRecorder.stop() → Blob (audio/webm)
    → FE upload Blob qua endpoint audio-upload có sẵn (đặt tên file .webm)
       (hoặc chunk qua createAudioSession + audio-tracks nếu chọn [NC-3])
SAU KHI UPLOAD — HOÀN TOÀN GIỐNG LUỒNG HIỆN CÓ, KHÔNG ĐỔI
  recording_sessions + media_files được tạo (như uploadAudioForTranscription hiện tại)
  → createTranscriptionJob() → pipeline Whisper + pyannote (không đổi)
```

### 4.1 [Hướng đề xuất — 2026-08-03] Lưu mốc gán tên: tái dùng anchor GIAI ĐOẠN 2, KHÔNG dùng marker GIAI ĐOẠN 3

Phát hiện quan trọng khi giải NC-4 sau khi Thiếu Chủ chốt mục 3.1: lý do GIAI ĐOẠN 3 phải bịa ra `meeting_events.recording_start_marker` là vì `recording_sessions.started_at` **chưa tồn tại lúc họp đang diễn ra** (chỉ được tạo lúc upload — có thể vài giờ/vài ngày sau). Với trạm cố định, **upload xảy ra ngay sau khi Host bấm "Dừng ghi"** (cùng phiên, cách nhau vài giây) — nên khi FE cần lưu các mốc gán tên đã thu thập trong lúc họp, `recording_sessions.started_at` **đã sẵn sàng gần như ngay lập tức**. Vậy có thể tái dùng chính xác cơ chế anchor mà GIAI ĐOẠN 2 (`tagSource='post'`) đã build + test kỹ, thay vì tạo cơ chế mới:

```text
Trong lúc họp: FE chỉ giữ mảng cục bộ [{ offsetSeconds, speakerUserId?, externalParticipantId?, displayName }, ...]
  KHÔNG gọi BE (khác GA-32 — GA-32 gọi BE ngay mỗi lần bấm)
Sau khi "Dừng ghi" → upload xong → có recordingSessionId + recording_sessions.started_at thật:
  FE gọi 1 endpoint mới (dạng bulk, giống GA-20 "POST /transcripts/:id/speaker-mappings" nhưng nhận
  offsetSeconds trực tiếp thay vì tự tính "mốc đại diện của cụm"):
    for each tag: event_time = recording_sessions.started_at + offsetSeconds
    ghi meeting_events { event_type='speaker_tag', tagSource='post', metadata_json:{ recordingSessionId, ... } }
    → TÁI DÙNG NGUYÊN VẸN applySpeakerMappingsFromEvents() đã có (tagSource='post') — không sửa SpeakerMappingService
```

**Lợi ích của hướng này:** không cần `tagSource` mới, không cần đụng logic quy chiếu/mâu thuẫn nào trong `SpeakerMappingService` (100% dùng lại code GIAI ĐOẠN 2 đã verify thật trên DB chung), không cần marker `meeting_events.recording_start_marker` cho luồng trạm cố định. Việc mới duy nhất ở BE là **một endpoint nhỏ nhận offset tường minh** — nhỏ hơn nhiều so với việc nối FE cho GA-30/32/35. Đây là hướng đề xuất, **chưa chốt** — xem NC-4 cập nhật bên dưới còn 2 câu hỏi nhỏ cần Thiếu Chủ xác nhận.

---

## 5. Functional Requirements (EARS) — đã cập nhật theo D-1..D-8

```text
FR-REC-006-001: THE FE SHALL cung cấp màn hình/nút "Bắt đầu ghi" / "Dừng ghi" trong app, dùng navigator.mediaDevices.getUserMedia({audio:true}) + MediaRecorder để ghi âm trực tiếp trong tab trình duyệt (KHÔNG cần app ghi âm ngoài).
FR-REC-006-002: WHEN Host bấm "Dừng ghi", THE FE SHALL nối các đoạn đã lưu thành 1 file (.webm — đã có sẵn trong SUPPORTED_AUDIO_EXTENSIONS) và upload qua endpoint audio-upload có sẵn — KHÔNG cần endpoint upload mới ở BE (D-2).
FR-REC-006-003: WHILE đang ghi, THE FE SHALL cắt đoạn định kỳ (MediaRecorder timeslice ~30-60s) và ghi mỗi đoạn xuống IndexedDB ngay khi nhận được, KHÔNG tích luỹ toàn bộ trong RAM (D-2).
FR-REC-006-004: WHEN Host bấm gán "người này đang nói" trong lúc đang ghi, THE FE SHALL tự tính offsetSeconds kể từ lúc bắt đầu ghi bằng đồng hồ trình duyệt cục bộ và lưu vào CÙNG bản ghi IndexedDB với audio (D-5); SHALL gửi hàng loạt lên BE ngay sau khi upload audio thành công — KHÔNG gọi 3 endpoint marker của GIAI ĐOẠN 3 (D-1).
FR-REC-006-005: THE BE SHALL cung cấp endpoint mới nhận danh sách mốc gán tên kèm offsetSeconds tường minh, ghi meeting_events với event_time = recording_sessions.started_at + offsetSeconds và tagSource='post' — SHALL NOT sửa đổi SpeakerMappingService hay logic áp mapping đã verify ở GIAI ĐOẠN 2 (D-4).
FR-REC-006-006: WHEN mở app trên máy trạm mà IndexedDB còn bản ghi chưa upload xong của phiên trước, THE FE SHALL đề nghị phục hồi và cho phép upload bù — phục hồi PHẢI bắt đầu từ đoạn đầu tiên và không bỏ sót đoạn nào (RISK-001).
FR-REC-006-007: THE FE SHALL chỉ hiện nút ghi âm khi phòng của cuộc họp có rooms.has_microphone = true (D-8).
FR-REC-006-008: IF trình duyệt/thiết bị không hỗ trợ MediaRecorder hoặc bị từ chối quyền mic, THEN THE FE SHALL báo lỗi rõ ràng và KHÔNG chặn luồng "upload file đã ghi sẵn" hiện có (AudioUploader.jsx vẫn hoạt động song song làm phương án dự phòng).
```

## 6. Quyết định đã chốt (Resolved Clarifications) — 2026-08-03

Toàn bộ NC-1..7 đã được giải quyết trong phiên thảo luận với Thiếu Chủ ngày 2026-08-03. Bảng dưới là **nguồn quyết định chính thức** cho plan.md/tasks.md.

| # | Vấn đề | Quyết định đã chốt | Căn cứ |
|---|---|---|---|
| **D-1** (NC-1) | Số phận GIAI ĐOẠN 3 (marker) | **Không đầu tư FE cho marker.** Giữ nguyên code BE GA-30/32/35 trong repo (đã test, không xoá, không sửa), chỉ không có FE gọi tới. Phòng có trạm cố định dùng cơ chế mới (D-4); phòng chưa có trạm tạm thời chỉ dùng gán-tên-sau-họp (GIAI ĐOẠN 2). **Không mất khả năng tìm người nói** — xem mục 3.1 (3 tầng). | Thiếu Chủ chốt |
| **D-2** (NC-2) | Chống mất dữ liệu khi ghi dài 60-90' | **1 file cuối cùng, nhưng sao lưu từng đoạn xuống IndexedDB trong lúc ghi.** `MediaRecorder` cắt đoạn mỗi ~30-60s (`timeslice`), mỗi đoạn ghi ngay xuống IndexedDB thay vì tích trong RAM → vừa **giảm nguy cơ tab crash** (RAM không phình theo thời lượng) vừa **phục hồi được** sau crash/mất điện (dữ liệu nằm trên đĩa). Cuối buổi nối các đoạn → 1 Blob → upload 1 lần qua endpoint `audio-upload` có sẵn. **KHÔNG cần endpoint chunk ở BE.** | Thiếu Chủ chốt |
| **D-3** (NC-3) | Có tái dùng `audio-tracks` cho chunk không | **Không áp dụng nữa** (D-2 đã bỏ hướng chunk-lên-server). Ghi nhận bằng chứng để đời sau không thử lại: `uploadAudioTrack()` **không thể** dùng cho chunk vì 3 chốt chặn cứng — (1) bắt buộc `meeting.status='completed'` (chunk đến lúc họp đang diễn ra sẽ bị chặn), (2) bắt buộc người gọi là participant, (3) **chặn 1 track/người/session** → chunk thứ 2 ăn `409 AUDIO_TRACK_ALREADY_EXISTS`. | [recording-session.service.ts:949-1005](../../../../src/modules/recording/services/recording-session.service.ts) |
| **D-4** (NC-4a) | Endpoint nhận mốc gán tên | **Endpoint MỚI dưới `recording-sessions`** (đề xuất route: `POST /meetings/:meetingId/recording-sessions/:sessionId/speaker-marks`), nhận thẳng `[{ offsetSeconds, speakerUserId?, externalParticipantId?, displayName }]`. **KHÔNG mở rộng GA-20** (`POST /transcripts/:id/speaker-mappings`) vì endpoint đó cần `transcriptId` — trong khi lúc upload xong transcript **chưa tồn tại** (đợi AI chạy ~1-2 tiếng theo RTF 1.73×). Endpoint mới ghi `meeting_events` với `event_time = recording_sessions.started_at + offsetSeconds`, `tagSource='post'`, `metadata_json.recordingSessionId=<sessionId>`. | [speaker-mapping.service.ts:604-640](../../../../src/modules/transcription/speaker-mapping.service.ts) — đã đọc code xác nhận anchor `post` = `recordingSession.startedAt`, offset = `event_time − anchor` ⇒ ghi vào bằng công thức ngược là khớp tuyệt đối, **không sửa một dòng nào trong `SpeakerMappingService`** |
| **D-5** (NC-4b) | Mốc gán tên có được lưu bền không | **Có — lưu chung vào đúng bản ghi IndexedDB của D-2.** Mốc gán tên và audio cùng sống, cùng phục hồi sau crash, không cần cơ chế riêng. (Hệ quả tự nhiên của D-2, không phải quyết định độc lập.) | Suy ra từ D-2 |
| **D-6** (NC-5) | Trạm cố định đăng nhập bằng tài khoản nào | **Host tự đăng nhập tài khoản của mình trên PC trạm đầu buổi, đăng xuất khi về.** KHÔNG sửa `assertHostOrAdmin`, KHÔNG tạo tài khoản trạm chung, KHÔNG cấp role Admin cho máy đặt trong phòng họp. Audit log ghi đúng người thật. Đánh đổi chấp nhận: thêm thao tác đăng nhập mỗi buổi. **Phát hiện quan trọng:** nếu chọn tài khoản chung không phải Host thì **mọi lần upload sẽ 403** — `assertHostOrAdmin` chỉ chấp nhận Host của đúng meeting đó hoặc `BUSINESS_ADMIN`/`SYSTEM_ADMIN`. | [recording-session.service.ts:1112-1137](../../../../src/modules/recording/services/recording-session.service.ts) |
| **D-7** (NC-6) | Giới hạn dung lượng upload | **Đủ, không phải rủi ro chặn thiết kế.** Opus/webm ở bitrate mặc định `MediaRecorder` cho ~90 phút rơi vào ~30-90MB, dưới xa `STORAGE_MAX_FILE_SIZE=524288000` (500MB). Nginx `client_max_body_size` trên EC2 đã sửa 2026-07-31. **Vẫn phải đo 1 lần bằng bản ghi thật** trên đúng mic hội nghị trước khi tuyên bố an toàn (đưa vào tasks.md như một task đo đạc, không phải giả định). | GA-04 (`.env`), ghi chép dự án 2026-07-31 |
| **D-8** (NC-7) | Đánh dấu phòng nào có trạm cố định | **Dùng cờ `rooms.has_microphone` đã có sẵn.** KHÔNG migration, KHÔNG cột mới, KHÔNG hard-code phòng pilot. Cờ này **đã được trả về FE sẵn** trong chi tiết cuộc họp ⇒ FE chỉ cần đọc để quyết định hiện/ẩn nút "Bắt đầu ghi". Mở rộng thêm phòng về sau chỉ là bật cờ qua màn hình quản lý phòng hiện có, không cần deploy. Đúng DATA-01. | [database_v4_current_41_tables.sql:311-313](../../../../database_v4_current_41_tables.sql), [meetings.controller.ts:738-742](../../../../src/modules/meetings/controllers/meetings.controller.ts) |

### 6.1 Điểm kỹ thuật cần smoke test trước khi tin (không phải quyết định, là rủi ro đã biết)

```text
RISK-001 (chunk webm không độc lập): Các đoạn MediaRecorder sinh ra khi dùng timeslice KHÔNG độc lập —
  chỉ đoạn đầu chứa header webm, các đoạn sau chỉ là dữ liệu thô. Nối đúng thứ tự thì ra file hợp lệ
  (nối byte đơn thuần, KHÔNG cần ffmpeg), nhưng lấy riêng một đoạn giữa thì không mở được.
  ⇒ Ảnh hưởng trực tiếp cách phục hồi ở D-2: phải phục hồi TỪ ĐOẠN ĐẦU, không được bỏ sót đoạn nào.
  ⇒ BẮT BUỘC smoke test trên đúng trình duyệt của máy trạm trước khi code phần phục hồi.

RISK-002 (thời lượng xử lý AI): Ghi càng dài, xử lý AI càng lâu theo RTF ~1.73× (họp 60' → ~1h44 xử lý).
  Không phải rủi ro riêng của feature này, nhưng trạm cố định làm việc ghi trọn buổi trở thành mặc định
  (trước đây Host có thể chỉ ghi phần quan trọng) ⇒ thời lượng trung bình sẽ tăng. Cần lường trước khi demo.

RISK-003 (quyền mic trình duyệt): getUserMedia yêu cầu HTTPS (hoặc localhost). Máy trạm truy cập app qua
  domain HTTPS thì cấp quyền 1 lần là xong — nhưng nếu truy cập qua IP/HTTP nội bộ sẽ bị chặn vĩnh viễn.
  Cần xác nhận cách máy trạm truy cập app trước khi lắp đặt.
```

---

## 7. Traceability

| Mục | Nguồn |
|---|---|
| RECON audio-upload/.webm | recording-session.controller.ts, recording-session.service.ts |
| RECON GIAI ĐOẠN 3 | feat-speaker-tagging-live/spec.md, PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md mục 7 |
| RECON FE hiện tại | AudioUploader.jsx, InMeetingRoom.jsx |
| D-1, D-2, D-6, D-8 | Thiếu Chủ chốt trực tiếp (phiên thảo luận 2026-08-03) |
| D-3, D-4, D-7 | Bằng chứng code thật do agent RECON, Thiếu Chủ xác nhận |
| D-5 | Hệ quả suy ra từ D-2 |
| RISK-001..003 | Ràng buộc kỹ thuật đã biết, cần smoke test — chưa verify thật |

---

> Trạng thái: **SPEC HOÀN CHỈNH — D-1..D-8 đã chốt, sẵn sàng viết plan.md.** Vẫn chưa code, chưa sửa dòng code nào của dự án. Việc tiếp theo: plan.md (thiết kế endpoint `speaker-marks` + luồng IndexedDB/phục hồi FE) rồi tasks.md, theo đúng quy trình speckit. RISK-001..003 phải được đưa vào tasks.md dưới dạng task đo đạc/smoke test, KHÔNG được giả định là đúng.
