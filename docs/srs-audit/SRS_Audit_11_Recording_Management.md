# Đánh giá SRS — Recording Management

## Tổng quan

Số UC: 8 | Khớp hoàn toàn: 0 | Khớp 1 phần: 6 | Sai hoàn toàn: 2 | Không có code: 0

Ghi chú tổng quan quan trọng nhất của mục này: **kiến trúc "Room Capture Agent" phần cứng tại phòng (thu đa kênh audio theo seat/channel, tự động chia đoạn 15 giây, tự động bắt đầu khi meeting IN_PROGRESS) mà SRS mô tả xuyên suốt UC-76/77 KHÔNG tồn tại trong code.** Code thực tế là:
- Video: một luồng **thủ công** (Host/Organizer/Admin bấm nút, chọn 1 `cameraDeviceId`, hệ thống kết nối RTSP tới đúng 1 camera đó) — không phải "System" tự động kết nối đồng thời 2 camera khi meeting bắt đầu.
- Audio: một luồng **upload file đã ghi sẵn** (participant tự ghi bằng trình duyệt rồi upload nguyên file, hoặc Host/Admin upload 1 file audio để test transcription) — không phải capture đa kênh trực tiếp từ phần cứng mic tại phòng.

Bằng chứng cho khẳng định trên: enum `RecordingSourceType` (`src/modules/recording/entities/recording-session.entity.ts:21-26`) có giá trị `CAPTURE_AGENT = 'capture_agent'` nhưng **không hề được khởi tạo (`new`/gán) ở bất kỳ đâu** trong toàn bộ module `recording` (grep xác nhận 0 kết quả sử dụng ngoài định nghĩa enum) — đây là placeholder schema, chưa từng được implement thành business logic.

---

## UC-73 — Tạo cấu hình ghi âm/ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form thiết lập gồm: Bật/Tắt thu hình (Video), Bật/Tắt thu âm (Audio), **Độ phân giải (720p/1080p)**, **Cấu hình Micro/Seat mapping**. PRE-2: cuộc họp phải đang ở trạng thái "Đã lên lịch" (Scheduled).

**Code thực tế (bằng chứng):**
- Route: `POST meetings/:meetingId/recording-config`, permission `recording.config.create` — `src/modules/recording/controllers/recording-config.controller.ts:29-55`.
- DTO thật (`src/modules/recording/dto/create-recording-config.dto.ts:1-55`): `enableAudio`, `enableVideo`, `enableTranscription`, `videoSourceDeviceId` (UUID, 1 camera cụ thể), `audioSourceMode`, `autoStart`, `consentRequired`, `retentionDays` (1-365). **Không có field độ phân giải (resolution), không có field seat/micro mapping.**
- `create()` (`src/modules/recording/services/recording-config.service.ts:87-163`): chỉ kiểm tra (1) meeting tồn tại, (2) quyền `assertCanConfigure` (dòng 48-85: role full-scope MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN cấu hình được mọi meeting; role khác — vd EMPLOYEE — bắt buộc phải là `organizer_id` hoặc `host_id` của chính meeting đó), (3) chưa có config (1:1, dòng 108-118), (4) `videoSourceDeviceId` nếu có phải là thiết bị `ip_camera` hợp lệ (dòng 120-123). **Không hề kiểm tra `meeting.status` — PRE-2 "phải Scheduled" không được enforce.**
- Config mặc định `status: RecordingConfigStatus.DRAFT` (dòng 139) — khái niệm "draft" không có trong SRS.

**Nhận xét:**
1. Thiếu hẳn field `resolution` (720p/1080p) mà SRS coi là tham số chính.
2. Thiếu hẳn field seat/micro mapping — chỉ có `audioSourceMode` (enum, không phải mapping chi tiết từng seat).
3. Thừa 4 field SRS không hề nhắc tới: `enableTranscription` (thuộc domain UC-81, lấn sang module Transcription), `autoStart`, `consentRequired`, `retentionDays`.
4. PRE-2 (meeting phải Scheduled) không được code kiểm tra — có thể tạo config kể cả khi meeting đã IN_PROGRESS/COMPLETED.
5. Quyền hạn thật chi tiết hơn SRS: không chỉ "Employee, Business Admin" chung chung mà phân biệt rõ full-scope role (Manager/Business Admin/System Admin cấu hình được MỌI meeting) và Employee chỉ khi là Host/Organizer của đúng meeting đó.

**Đề xuất sửa SRS:**
> Field cấu hình thực tế: `enableVideo` (bool), `enableAudio` (bool), `enableTranscription` (bool), `videoSourceDeviceId` (UUID, tham chiếu 1 camera IP cụ thể), `audioSourceMode` (enum), `autoStart` (bool, lưu nhưng hiện KHÔNG được hệ thống tự động dùng để kích hoạt ghi hình), `consentRequired` (bool, mặc định true), `retentionDays` (1-365, tùy chọn). Không có field độ phân giải hay seat/micro mapping chi tiết. PRE-2 (meeting phải "Scheduled") hiện KHÔNG được backend kiểm tra khi tạo config — cần bổ sung nếu team muốn giữ ràng buộc này. Quyền tạo: role Manager/Business Admin/System Admin tạo được cho mọi meeting; role khác chỉ khi là Organizer hoặc Host của chính meeting đó (permission `recording.config.create` + kiểm tra sở hữu).

---

## UC-74 — Xem cấu hình ghi âm/ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Hiển thị chỉ đọc các tham số: Độ phân giải, Trạng thái bật/tắt audio/video, Mapping micro. PRE-1: đã có config (UC-REC-01).

**Code thực tế (bằng chứng):**
- Route: `GET meetings/:meetingId/recording-config`, permission `recording.config.read` — `src/modules/recording/controllers/recording-config.controller.ts:58-73`.
- `findOne()` (`recording-config.service.ts:165-191`): trả 404 `RECORDING_CONFIG_NOT_FOUND` nếu chưa có config; cùng gate `assertCanConfigure` như UC-73 (Host/Organizer hoặc role full-scope) — nghĩa là đây **không phải màn hình đọc công khai cho mọi thành viên meeting**, mà giới hạn theo cùng quy tắc sở hữu như khi tạo.
- Response DTO (`src/modules/recording/dto/recording-config-response.dto.ts`) phản ánh đúng field thật của entity (không có resolution/seat mapping, vì các field đó không tồn tại — xem UC-73).

**Nhận xét:**
1. Field hiển thị thiếu resolution/seat-mapping tương tự UC-73 (hệ quả tất yếu vì các field đó không tồn tại trong entity).
2. SRS PRE-1 chỉ nói "config đã tồn tại"; không đề cập việc chỉ Host/Organizer/role-full-scope mới xem được — participant thường không có quyền `recording.config.read` cho meeting mình không phải Host/Organizer.

**Đề xuất sửa SRS:**
> Xem cấu hình dùng chung endpoint `GET /meetings/:meetingId/recording-config`, giới hạn cho Host/Organizer của chính meeting đó hoặc role Manager/Business Admin/System Admin (không mở cho participant thường). Field hiển thị: `enableVideo`, `enableAudio`, `enableTranscription`, `videoSourceDeviceId`, `audioSourceMode`, `autoStart`, `consentRequired`, `retentionDays`, `status` (draft/...). Không có field độ phân giải hay seat mapping.

---

## UC-75 — Cập nhật cấu hình ghi âm/ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** PRE-2: cuộc họp chưa chuyển sang "Đang diễn ra" (IN_PROGRESS). EX1: nếu cuộc họp đã bắt đầu (IN_PROGRESS), hệ thống chặn sửa cấu hình.

**Code thực tế (bằng chứng):**
- Route: `PATCH meetings/:meetingId/recording-config`, permission `recording.config.update` — `recording-config.controller.ts:76-103`.
- `update()` (`recording-config.service.ts:193-234`): guard chặn sửa **không** dựa vào `meeting.status`, mà dựa vào việc **có `recording_sessions` đang active hay không**:
  ```
  SELECT id FROM recording_sessions
  WHERE meeting_id = $1 AND status IN ('starting','recording','paused') AND stopped_at IS NULL
  ```
  Nếu có → `ConflictException` code `RECORDING_IN_PROGRESS` (dòng 219-234).
- Chỉ field nằm trong whitelist `FIELDS` (dòng 241-250, đúng 8 field như UC-73/create) mới được cập nhật; field không đổi giá trị bị bỏ qua (idempotent, dòng 263-266).

**Nhận xét:**
Đây là khác biệt điều kiện quan trọng, không chỉ là chi tiết nhỏ: SRS block theo trạng thái **meeting**, code block theo trạng thái **recording session**. Hệ quả thực tế:
- Meeting đã IN_PROGRESS nhưng recording video/audio CHƯA từng được bấm Start → theo SRS phải bị chặn sửa cấu hình, nhưng code **cho phép sửa bình thường**.
- Ngược lại nếu (giả định) một recording session còn active dù meeting đã kết thúc (race condition hiếm, trước khi auto-stop kịp chạy) → code vẫn chặn sửa dù meeting không còn IN_PROGRESS.

**Đề xuất sửa SRS:**
> EX1 (Cập nhật khi đang ghi hình): Hệ thống chặn sửa cấu hình nếu **đang tồn tại một `recording_sessions` ở trạng thái `starting`/`recording`/`paused` cho meeting này** (không phải dựa theo `meeting.status`) — trả lỗi `RECORDING_IN_PROGRESS` (409). Một meeting IN_PROGRESS nhưng chưa từng bấm bắt đầu ghi hình vẫn có thể sửa cấu hình bình thường.

---

## UC-76 — Ghi hình Cuộc họp qua Camera IP Góc phòng (Bắt đầu/Dừng)

**Trạng thái:** ❌ SAI HOÀN TOÀN

**SRS hiện tại ghi:** Primary Actor: **System** (tự động). Normal Flow Start: hệ thống tự phát hiện meeting → IN_PROGRESS rồi tự kết nối RTSP/ONVIF tới **cả hai** camera góc phòng cùng lúc, không cần thao tác người dùng. BR-01: một khi đã Dừng Ghi hình thì phiên đóng vĩnh viễn, **không có lệnh "Tiếp tục" (Resume)** — phải tạo phiên hoàn toàn mới.

**Code thực tế (bằng chứng):**
- `POST live-meetings/:meetingId/recording/start-video`, permission `recording.video.start`, body chứa **1** `cameraDeviceId` cụ thể — `src/modules/recording/controllers/recording-session.controller.ts:34-55`.
- `startVideo()` (`src/modules/recording/services/recording-session.service.ts:69-274`): là hành động **thủ công theo yêu cầu HTTP**, không có bất kỳ cơ chế nào tự trigger khi meeting chuyển IN_PROGRESS. Dòng 93-98: kiểm tra `assertHostOrAdmin` — chỉ Host/Organizer của chính meeting hoặc Admin mới được bắt đầu, KHÔNG phải "System" tự động. Dòng 133-166: khoá `pg_advisory_xact_lock`, chỉ cho phép **1 session active tại 1 thời điểm cho mỗi meeting** (`RECORDING_ALREADY_ACTIVE` nếu đã có) — không có khái niệm 2 camera cùng ghi trong 1 session logic.
- Field `recording_configs.autoStart` được lưu (`create-recording-config.dto.ts:42`, `recording-config.entity.ts:60-61`) nhưng **không được đọc/sử dụng ở bất kỳ đâu để tự động kích hoạt ghi hình** (grep toàn module `recording`: chỉ xuất hiện trong DTO/entity/response-mapping, không xuất hiện trong bất kỳ logic điều kiện nào) — là field "chết", gây hiểu lầm rằng có thể tự động hoá nhưng thực chất chưa được nối logic.
- **Pause/Resume tồn tại và hoạt động đầy đủ** — trực tiếp mâu thuẫn BR-01: `POST .../pause-video` (`recording-session.controller.ts:82-103`) và `POST .../resume-video` (dòng 105-126), cùng permission `recording.video.stop`; logic tại `recording-session.service.ts:481` (`pauseVideo`) và `:576` (`resumeVideo`). Khi `stopVideo()` chạy trên 1 session đã từng pause/resume, nó **concat nhiều segment thành 1 file** (`resolveStopFile`, tham chiếu dòng 375-379) — nghĩa là code chủ động thiết kế cho trường hợp resume nhiều lần, đối lập hoàn toàn với "không có lệnh Tiếp tục" của BR-01.
- Điểm khớp thật sự: AF-2 (tự động dừng khi meeting COMPLETED) **có khớp** — `endMeeting()` gọi `stopAllActiveForMeeting()` (`src/modules/live-meeting/services/live-meeting.service.ts:2012`, xác nhận bằng test `live-meeting.service.spec.ts:556-600`, gắn nhãn "[FIX 2026-08-12, R9 — Lớp 1]"), dừng toàn bộ session active của meeting một cách tự động, không cần Host xác nhận — khớp đúng AF-2. AF-3 (crash-recovery) cũng có khớp một phần: `RecordingReconcileService` (`src/modules/recording/services/recording-reconcile.service.ts:30-100`) chạy tại `onApplicationBootstrap()`, quét session còn `starting/recording/paused` mà `stopped_at IS NULL`, finalize file nếu tồn tại hoặc đánh dấu failed — đúng tinh thần AF-3, dù cơ chế cụ thể (dựa vào file tồn tại trên đĩa, không phải "khôi phục kết nối camera") khác chi tiết SRS mô tả.

**Nhận xét:**
Đây là ❌ SAI HOÀN TOÀN vì **Normal Flow chính** (actor System tự động, khởi động đồng thời cả 2 camera khi meeting bắt đầu) không tồn tại — luồng thật là thủ công, đơn-camera-mỗi-session. Thêm vào đó, **BR-01 (business rule tường minh nhất của UC này) bị code làm trái ngược hoàn toàn** bằng tính năng Pause/Resume có chủ đích. Chỉ 2 nhánh phụ (AF-2 auto-stop, AF-3 crash-recovery) là khớp tinh thần.

**Đề xuất sửa SRS:**
> **Primary Actor: Host/Organizer của cuộc họp, hoặc Business Admin/System Admin** (không phải "System" tự động). Trigger Start: người dùng có quyền chủ động gọi `POST /live-meetings/:meetingId/recording/start-video` kèm `cameraDeviceId` (1 camera IP cụ thể, không phải đồng thời cả 2). Hệ thống khoá để đảm bảo chỉ 1 session ghi hình active/meeting tại một thời điểm (409 `RECORDING_ALREADY_ACTIVE` nếu đã có). Có hỗ trợ **Tạm dừng** (`pause-video`) và **Tiếp tục** (`resume-video`) trong cùng 1 session (nhiều segment sẽ được ffmpeg concat lại thành 1 file khi Dừng hẳn) — bỏ BR-01 "không có lệnh Tiếp tục". Dừng (`stop-video`) vẫn có thể do người dùng chủ động hoặc **tự động khi meeting chuyển COMPLETED** (`endMeeting()` gọi dừng toàn bộ session active, best-effort — lỗi ở 1 session không chặn các session khác). Khi backend khởi động lại, `RecordingReconcileService` tự quét và đóng an toàn các session còn dở dang (dựa trên sự tồn tại của file trên đĩa để quyết định finalize hay đánh dấu failed).

---

## UC-77 — Ghi âm theo Từng Người Tham dự (Bắt đầu/Chia đoạn/Dừng)

**Trạng thái:** ❌ SAI HOÀN TOÀN

**SRS hiện tại ghi:** Primary Actor: System. Room Capture Agent tự động thu đa kênh audio khi meeting IN_PROGRESS, ánh xạ mỗi kênh vật lý với `channel_id`/`seat_id`; định kỳ (VD mỗi 15 giây) tự động cắt luồng liên tục thành segment; dừng và hoàn thiện tệp theo `mic_device_id` khi meeting kết thúc.

**Code thực tế (bằng chứng):** Không có bất kỳ endpoint nào khởi động một "phiên thu audio đa kênh trực tiếp từ phần cứng". Thay vào đó là kiến trúc **upload file đã ghi sẵn**, hoàn toàn khác:
- `POST meetings/:meetingId/recording-sessions` — tạo 1 "audio session rỗng" làm điểm neo, `sourceType: RecordingSourceType.MANUAL_UPLOAD` (`recording-session.service.ts:823-871`, xem dòng 856-857) — chú thích ngay tại dòng 158-161 của controller: "Gap fix... tạo audio session 'rỗng' làm điểm neo (sessionId) để N participant lần lượt upload audio-tracks vào cùng 1 session".
- `POST meetings/:meetingId/recording-sessions/:sessionId/audio-tracks` — từng participant **tự upload file audio đã ghi trên trình duyệt của họ** (`recording-session.controller.ts:210-242`, permission `recording.upload_track`).
- `GET meetings/:meetingId/recording-sessions` — participant tự tra danh sách session để lấy đúng `sessionId` cần upload vào, vì "participant không có cách nào tự tìm recordingSessionId... ngoài việc Host relay tay" (chú thích dòng 186-189).
- `POST meetings/:meetingId/recording-sessions/audio-upload` — luồng ad-hoc riêng biệt, dùng để Host/Admin upload 1 file `.wav/.mp3/.m4a` **có sẵn** nhằm test pipeline transcription khi "không có camera/capture agent thật" (chú thích dòng 128-131) — tự thừa nhận trong code rằng phần cứng Room Capture Agent thật không tồn tại trong luồng này.
- Enum `RecordingSourceType` (`recording-session.entity.ts:21-26`) có `CAPTURE_AGENT` nhưng **không bao giờ được gán** — xác nhận bằng grep toàn module, chỉ xuất hiện tại dòng định nghĩa enum.
- Không có bất kỳ logic "cắt segment mỗi 15 giây" nào cho audio trong code. Cơ chế "segment" duy nhất tồn tại trong module này là của **video** pause/resume (UC-114/115), khác hoàn toàn mục đích/cơ chế với "Chia đoạn" mà SRS UC-77 mô tả cho audio đa kênh.

**Nhận xét:**
Toàn bộ Normal Flow (System tự động thu đa kênh qua Room Capture Agent, ánh xạ channel/seat, tự cắt đoạn 15 giây) không tồn tại. Kiến trúc thật là participant/Host **chủ động upload file audio đã ghi sẵn** (không phải capture trực tiếp từ phần cứng phòng họp), không có auto-segmenting, không có ánh xạ seat_id/channel_id tự động — chỉ có 1 file/track do người dùng tự đặt tên và tự upload. Đây là trường hợp "SRS mô tả thiết kế cũ (Room Capture Agent phần cứng), đã bị thay bằng thiết kế mới (upload thủ công theo participant)" — rõ ràng nhất trong toàn bộ Mục 11.

**Đề xuất sửa SRS:**
> **Primary Actor: Host/Organizer (tạo audio session) và từng Participant (tự upload track của mình)** — không phải "System" tự động qua Room Capture Agent. Luồng thật: (1) Host/Organizer/Admin gọi `POST /meetings/:meetingId/recording-sessions` để tạo 1 audio session rỗng làm điểm neo; (2) mỗi participant tự `GET /meetings/:meetingId/recording-sessions` để tìm đúng `sessionId`, sau đó tự ghi âm bằng trình duyệt của mình (vd MediaRecorder) và `POST .../recording-sessions/:sessionId/audio-tracks` để upload file track hoàn chỉnh của họ (permission `recording.upload_track`). Không có auto-segmenting mỗi 15 giây, không có ánh xạ `channel_id`/`seat_id` tự động từ phần cứng — mỗi track là 1 file độc lập do người dùng tự upload. Ngoài ra có luồng phụ `POST .../recording-sessions/audio-upload` để Host/Admin upload nhanh 1 file audio có sẵn nhằm test transcription khi không có thiết bị ghi âm phòng thật.

---

## UC-78 — Xem Danh sách & Chi tiết File Ghi âm/Ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Danh sách + Chi tiết là 2 mức độ của cùng use case Đọc. AF-1: lọc theo Video/Audio hoặc theo `seat_id`/`channel_id`. AF-2: Business Admin xem danh sách tệp **từ bảng quản trị hệ thống**, duyệt tệp trên **nhiều cuộc họp**.

**Code thực tế (bằng chứng):**
- `GET meetings/:meetingId/media-files`, permission `recording.files.read` — `src/modules/recording/controllers/media-files.controller.ts:35-51`; `list()` (`src/modules/recording/services/media-files.service.ts:65-99`) chỉ nhận filter `fileType` (csv, dòng 80-88) — **không có filter theo `seat_id`/`channel_id`**. Query `ListMediaQueryDto` (`src/modules/recording/dto/list-media-query.dto.ts:1-23`) chỉ có `page`, `limit`, `fileType`.
- `GET media-files/:fileId`, permission `recording.files.read` — `detail()` (`media-files.service.ts:102-125`) trả đầy đủ metadata (`fileSizeBytes`, `durationSeconds`, `checksum`, `versionNo`, `metadataJson`, `downloadUrl` — signed URL sinh sẵn, xem UC-79).
- Danh sách **luôn scoped theo 1 `meetingId`** (route có `:meetingId` bắt buộc) — **không có endpoint admin xem cross-meeting** như AF-2 mô tả ("bảng quản trị hệ thống... nhiều cuộc họp").

**Nhận xét:**
1. AF-1 (lọc theo seat/channel) không tồn tại — chỉ lọc được theo loại file (video/audio).
2. AF-2 (màn hình quản trị admin xem tệp xuyên nhiều meeting) không có endpoint tương ứng — mọi truy vấn đều phải biết trước `meetingId`.
3. BR-01 (Business Admin/Host toàn quyền, Participant mặc định chỉ xem tệp chính đã share) không được code enforce ở tầng phân quyền UC này — permission `recording.files.read` là nhị phân (có/không), không có logic phân biệt "chỉ xem tệp chính do Host chia sẻ" cho participant thường trong `list()`/`detail()`.

**Đề xuất sửa SRS:**
> Danh sách/chi tiết chỉ truy vấn theo phạm vi 1 meeting cụ thể (`GET /meetings/:meetingId/media-files`, `GET /media-files/:fileId`), lọc được theo `fileType` (video/audio, dạng CSV) — chưa hỗ trợ lọc theo seat_id/channel_id. Chưa có màn hình admin xem tệp xuyên nhiều cuộc họp. Quyền truy cập hiện là nhị phân theo permission `recording.files.read` (có hoặc không), chưa có tầng lọc "participant chỉ thấy tệp Host đã chia sẻ".

---

## UC-79 — Phát lại file ghi âm/ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Hệ thống tạo 1 Signed-URL tạm thời để truy cập tệp từ Storage Service, rồi trình phát tích hợp (in-app player) mở và stream nội dung qua Signed-URL đó.

**Code thực tế (bằng chứng):** Có **2 cơ chế tách biệt**, không phải 1 luồng signed-URL duy nhất như SRS mô tả:
1. `GET media-files/:fileId/playback`, permission `recording.files.play` (`media-files.controller.ts:68-139`) — stream **trực tiếp qua JWT session hiện tại** (không qua signed-URL riêng), hỗ trợ đầy đủ HTTP Range request (206 Partial Content, dòng 86-133) để tua video/audio — đây chính là endpoint player thật sự dùng.
2. `GET media-files/:fileId/secure-download?token=...` (dòng 177-229) — endpoint **signed-URL thật sự** (HMAC token, không cần JWT, xác thực qua `verifySignedDownloadToken`), dùng cho các ngữ cảnh tải xuống/nhúng ngoài phiên đăng nhập (vd link trong report/email) — được sinh sẵn trong `detail()` response (`downloadUrl`, `media-files.service.ts:123, 133-153`).

**Nhận xét:**
SRS mô tả 1 luồng duy nhất "tạo signed-URL → player mở signed-URL đó", nhưng thực tế player trong ứng dụng dùng thẳng `playback` (JWT-guarded, không phải signed-URL), còn cơ chế signed-URL (`secure-download`) là một đường **khác**, tách biệt, phục vụ mục đích tải/nhúng ngoài phiên (không phải cơ chế chính mà UI player sử dụng). Nhầm lẫn 2 khái niệm này có thể dẫn team FE hiểu sai luồng cần gọi.

**Đề xuất sửa SRS:**
> Có 2 endpoint phục vụ 2 mục đích khác nhau: `GET /media-files/:fileId/playback` (yêu cầu JWT + permission `recording.files.play`, hỗ trợ HTTP Range để tua) — đây là endpoint chính mà trình phát trong ứng dụng gọi trực tiếp, không qua signed-URL. `GET /media-files/:fileId/secure-download?token=...` — endpoint xác thực bằng short-lived signed HMAC token (không cần JWT), dùng khi cần chia sẻ/nhúng link ra ngoài phiên đăng nhập hiện tại (token này được sinh sẵn kèm trong response của UC-78 "Xem Chi tiết", field `downloadUrl`).

---

## UC-80 — Xóa/Ẩn file ghi âm/ghi hình

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Normal Flow (mặc định) là **xóa vĩnh viễn**: "Hệ thống gửi lệnh xóa tới Storage Service và cập nhật xóa bản ghi... không thể khôi phục". AF-1 (nhánh phụ) mới là "Ẩn tệp" — chỉ đổi visibility flag, giữ nguyên file vật lý.

**Code thực tế (bằng chứng):**
- Route duy nhất: `PATCH media-files/:fileId/visibility`, permission `recording.files.manage`, body `VisibilityDto` (`src/modules/recording/dto/visibility.dto.ts:1-14`): `action: 'hide' | 'soft_delete'`.
- `setVisibility()` (`src/modules/recording/services/media-files.service.ts:286-299`):
  - `action='hide'` → chỉ `UPDATE isActive=false` (dòng 292-294) — khớp AF-1.
  - `action='soft_delete'` → chỉ gọi TypeORM `repo.softDelete(fileId)` (dòng 296-297), tức **chỉ set cột `deleted_at`** — **KHÔNG hề gọi Storage Service để xóa file vật lý**, và về nguyên tắc có thể khôi phục (clear `deleted_at`) — trái ngược trực tiếp với câu "không thể khôi phục" và "gửi lệnh xóa tới Storage Service" mà SRS khẳng định là hành vi mặc định.
- Không có endpoint `DELETE` nào khác trong `media-files.controller.ts` (đã đọc toàn bộ 231 dòng) — xác nhận **hoàn toàn không có xóa vĩnh viễn thật (hard delete + xóa file vật lý)** ở bất kỳ đâu trong module.

**Nhận xét:**
SRS coi "xóa vĩnh viễn không thể khôi phục" là hành vi **chính**, "ẩn" chỉ là lựa chọn phụ (AF-1). Code thực tế đảo ngược hoàn toàn mức độ nghiêm trọng: cả 2 action (`hide` và `soft_delete`) đều là thao tác **có thể khôi phục về mặt kỹ thuật** và đều **không đụng đến file vật lý trên Storage** — không có con đường nào trong code hiện thực đúng lời khẳng định "gửi lệnh xóa tới Storage Service" / "không thể khôi phục" của SRS.

**Đề xuất sửa SRS:**
> Một endpoint duy nhất `PATCH /media-files/:fileId/visibility` (permission `recording.files.manage`) với body `{action: 'hide' | 'soft_delete', reason?}`. Cả hai action đều **không xóa file vật lý trên Storage Service** và đều **có thể khôi phục được về mặt kỹ thuật** (đổi cờ `isActive`, hoặc set/clear cột `deleted_at`): `hide` → set `isActive=false` (tệp vẫn còn nguyên, chỉ ẩn khỏi danh sách mặc định); `soft_delete` → set `deleted_at` (tệp bị loại khỏi mọi truy vấn `list`/`detail` nhưng bản ghi và file vật lý vẫn tồn tại). Chưa có cơ chế xóa vĩnh viễn thật (hard delete + xóa file khỏi Storage) trong hệ thống.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Pause/Resume ghi hình video** (nội bộ gọi UC-114/UC-115) — `POST .../pause-video`, `POST .../resume-video` (`recording-session.controller.ts:82-126`), cho phép tạm dừng và tiếp tục ghi trong cùng 1 session, các segment được ffmpeg concat lại thành 1 file khi Dừng hẳn. Trực tiếp mâu thuẫn BR-01 của UC-76 (xem phần UC-76 ở trên) — SRS cần được viết lại thay vì chỉ "bổ sung", vì đây là một business rule bị đảo ngược, không phải một tính năng thiếu đơn thuần.
2. **Kiến trúc audio hoàn toàn dựa trên upload thủ công** thay thế "Room Capture Agent" phần cứng: `createAudioSession` (điểm neo) + `listRecordingSessions` (participant tự tra sessionId) + `uploadAudioTrack` (từng participant tự upload track) — xem chi tiết ở UC-77.
3. **Endpoint test/ad-hoc** `POST meetings/:meetingId/recording-sessions/audio-upload` — Host/Admin upload nhanh 1 file audio có sẵn (`.wav/.mp3/.m4a/...`) để feed pipeline transcription khi không có thiết bị ghi âm thật (`recording-session.controller.ts:128-156`).
4. **`GET live-meetings/:meetingId/recording/:sessionId/status`** — endpoint đọc trạng thái phiên ghi hình real-time (`recording-session.controller.ts:245-262`, permission `recording.video.status`) — không có trong SRS.
5. **`secure-download` (signed HMAC token, không cần JWT)** — dùng chung hạ tầng với module biometric/avatar (tag `ACCT-AVATAR-REVIEW-001` ngay trong code, `media-files.controller.ts:176`) — cơ chế chia sẻ hạ tầng xuyên module không được SRS Recording Management nhắc tới.
6. **`RecordingReconcileService`** (`recording-reconcile.service.ts`) — chạy khi backend khởi động (`OnApplicationBootstrap`), tự động dò và đóng an toàn các recording session bị "mồ côi" (orphan) sau khi backend restart giữa chừng lúc đang ghi — cơ chế NFR khá tinh vi (đọc file trên đĩa để quyết định finalize-as-stopped hay đánh dấu failed), có cảnh báo rõ trong code (dòng 25-27) rằng thiết kế hiện tại giả định **single-instance** — nếu scale nhiều instance sẽ cần thêm `instance_id`/heartbeat, hiện chưa có.
7. **`recording_configs.autoStart`** — field được lưu trong DB nhưng không được bất kỳ logic nào trong module đọc lại để tự động kích hoạt ghi hình — một field "chết", nên cân nhắc loại bỏ khỏi API hoặc thực sự nối logic nếu team muốn tính năng auto-start thật.
8. **`RecordingSourceType.CAPTURE_AGENT`** — enum tồn tại trong entity nhưng chưa từng được sử dụng ở bất kỳ đâu trong business logic — placeholder cho phần cứng Room Capture Agent mà SRS mô tả nhưng chưa được implement.
