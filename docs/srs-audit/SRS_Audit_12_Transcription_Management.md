# Đánh giá SRS — Transcription Management

## Tổng quan

Số UC: 4 | Khớp hoàn toàn: 0 | Khớp 1 phần: 3 | Sai hoàn toàn: 0 | Không có code: 1

Ghi chú: UC-84 trong SRS có tiêu đề tự ghi "(bỏ UC này)" nhưng phần "Other Information" lại ghi ngược lại "vẫn giữ như một UC riêng biệt" — SRS tự mâu thuẫn ngay trong chính nó. Kết quả kiểm tra code (xem UC-84 bên dưới) cho thấy phương án "bỏ UC này" (đúng như tiêu đề) là hợp lý hơn, vì không có bất kỳ đoạn code nào hiện thực hoá nó như một tính năng nghiệp vụ riêng biệt.

---

## UC-81 — Chuyển đổi giọng nói thành văn bản

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Primary Actor: **System (automated)**, Employee (Host) chỉ là actor phụ. Trigger chính: "Cuộc họp kết thúc và bản ghi âm được lưu trữ thành công" (tự động), thao tác thủ công chỉ là lựa chọn "hoặc". Normal Flow bước 5: dịch vụ AI đối chiếu luồng âm thanh với **sơ đồ cấu hình chỗ ngồi (Seat assignment)** để nhận diện vị trí; bước 6: **tự động** gán nhãn tên thật.

**Code thực tế (bằng chứng):**
- Route: `POST meetings/:meetingId/transcription-jobs`, permission `transcript.create` — `src/modules/transcription/transcription.controller.ts:41-76`. Đây là **endpoint duy nhất** khởi tạo job; grep `createTranscriptionJob` toàn repo chỉ ra nó được gọi từ đúng 1 nơi (controller này) — **không có bất kỳ trigger tự động nào** (không có hook trong `live-meeting.service.ts` khi `endMeeting()`, không có cron, không có listener trên sự kiện dừng ghi âm) gọi hàm này.
- `createTranscriptionJob()` (`src/modules/transcription/transcription.service.ts:78-282`): bắt buộc `dto.recordingSessionId` cụ thể trong body (dòng 131-143); bắt buộc người gọi là Host của **chính meeting đó** hoặc có role Admin (dòng 117-129) — hoàn toàn là hành động chủ động của con người, không phải "System" tự động theo trigger "meeting kết thúc".
- Bước "đối chiếu sơ đồ chỗ ngồi": **không tồn tại**. Thay vào đó, code tự động chọn 1 trong 2 chế độ dựa trên **số lượng file audio đã upload** cho session (dòng 165-184): `diarization_only` nếu chỉ có 1 file gộp (AI tự phân tách giọng nói chung chung, không biết tên thật), hoặc `channel_zone` nếu có nhiều file (mỗi file ứng với 1 `channelUserId` do người dùng tự gắn khi upload — xem Mục 11 UC-77). Không có khái niệm "sơ đồ chỗ ngồi phòng họp" nào được tham chiếu trong toàn bộ luồng.
- Engine xử lý: Whisper self-hosted qua hàng đợi (`TRANSCRIPTION_QUEUE_NAME`, `transcription-worker.processor.ts`) — điểm này **khớp đúng** với ghi chú "Other Information" của SRS (đã thay Google STT bằng Whisper).
- Có feature flag `TRANSCRIPTION_ENABLED` (mặc định `true`, dòng 88-101) — chưa được SRS nhắc tới.

**Nhận xét:**
1. Actor/Trigger thực tế là **con người chủ động** (Host/Admin gọi API với `recordingSessionId` cụ thể), không phải "System" tự động theo sự kiện meeting kết thúc — không tìm thấy bất kỳ cơ chế tự động kích hoạt nào trong toàn bộ codebase.
2. Cơ chế nhận diện người nói theo "sơ đồ chỗ ngồi (Seat assignment)" mà SRS mô tả không tồn tại — cơ chế thật dựa trên số lượng file audio (diarization chung hoặc theo từng file/`channelUserId`), kết hợp với hệ thống "Live Speaker Tagging" riêng biệt (xem Phát hiện phụ #1) để gán tên thật.
3. Whisper self-hosted khớp đúng với SRS.

**Đề xuất sửa SRS:**
> **Primary Actor: Host/Organizer của cuộc họp (hoặc Business/System Admin)** — không phải "System" tự động. Trigger: người dùng chủ động gọi `POST /meetings/:meetingId/transcription-jobs` kèm `recordingSessionId` cụ thể (không tự kích hoạt khi meeting kết thúc). Hệ thống tự chọn chế độ xử lý dựa trên số file audio của session: 1 file → `diarization_only` (AI tự phân tách người nói chung chung, không có tên thật); nhiều file (mỗi participant tự upload 1 file riêng) → `channel_zone` (mỗi đoạn gắn sẵn `channelUserId` của người upload). Không có bước đối chiếu "sơ đồ chỗ ngồi phòng họp". Việc gán tên thật chính xác cho từng đoạn hội thoại phụ thuộc vào hệ thống Live Speaker Tagging riêng (Host tự đánh dấu "ai đang nói" trong lúc họp, hoặc gắn mốc offset sau khi có bản ghi) — không phải suy luận tự động từ vị trí ghế. Engine xử lý: Whisper (self-hosted, qua hàng đợi background job).

---

## UC-82 — Xem transcript cuộc họp

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Hiển thị timeline cuộn dọc, mỗi đoạn gồm: Timestamp, **Định danh người nói (tên đầy đủ nếu ghế/kênh đã gán)**, **Thông tin vị trí/kênh (VD: Ghế số 3 / Kênh âm thanh số 2)**, nội dung văn bản. BR1: quyền xem kế thừa từ bảo mật cuộc họp gốc (organizer, khách mời chính thức, quản lý trực tiếp).

**Code thực tế (bằng chứng):**
- Route: `GET meetings/:meetingId/transcript`, permission `transcript.read`, query `includeSegments`/`page`/`limit` — `transcription.controller.ts:102-131`.
- `getTranscript()` (`transcription.service.ts:284-380`): authz là **bất kỳ hàng nào trong `meeting_participants` khớp `meetingId`+`userId`** (dòng 303-315, không phân biệt vai trò participant/organizer/khách mời) HOẶC có role Admin — khớp tinh thần BR1 nhưng không phân biệt chi tiết "khách mời chính thức" vs người dự thính như SRS ngụ ý.
- Segment trả về gồm `startMs`/`endMs` (quy đổi thêm `absoluteStartAt`/`absoluteEndAt` theo giờ Việt Nam, dòng 347-356) + nội dung — **không có field "Ghế số X / Kênh âm thanh số Y"** hiển thị dạng vị trí vật lý; field gần nhất là `channelUserId` (khi ở chế độ `channel_zone`, xem UC-81) hoặc nhãn `speakerLabel`/`userId` chung chung (khi `diarization_only`, chỉ có nếu đã được Live Speaker Tagging gán — xem Phát hiện phụ #1).
- Hỗ trợ phân trang segment (`page`/`limit`, dòng 336-357, mặc định limit 50) — tính năng không có trong SRS nhưng hợp lý cho transcript dài.

**Nhận xét:**
1. Không có field "Ghế số X / Kênh âm thanh số Y" như SRS mô tả cụ thể — chỉ có `channelUserId` (khi có) hoặc nhãn speaker chung.
2. Tên thật người nói **không tự động có sẵn** — chỉ hiện diện nếu: (a) ở chế độ `channel_zone` (suy ra trực tiếp từ ai đã upload file đó), hoặc (b) Host đã dùng tính năng Live Speaker Tagging để gán thủ công. SRS diễn đạt "nếu vị trí ghế ngồi/kênh âm thanh đã gán với người tham dự trước đó" có tính dự phòng đúng hướng, nhưng cơ chế "gán trước đó" thật sự là thao tác thủ công của Host, không phải tự động từ seat assignment.
3. Quyền xem dựa trên "có mặt trong `meeting_participants`" nói chung, chưa phân biệt vai trò chi tiết như SRS ngụ ý (organizer/khách mời chính thức/quản lý).

**Đề xuất sửa SRS:**
> Timeline mỗi đoạn gồm: timestamp (tương đối `startMs`/`endMs` + quy đổi giờ Việt Nam tuyệt đối), nội dung văn bản, và định danh người nói **nếu có** — lấy từ `channelUserId` (chế độ nhiều file, biết chắc ai upload) hoặc từ nhãn do Host gán thủ công qua tính năng Live Speaker Tagging (không phải suy luận tự động từ sơ đồ chỗ ngồi). Không có khái niệm hiển thị "số ghế/số kênh vật lý". Hỗ trợ phân trang segment qua `page`/`limit`. Quyền xem: bất kỳ ai có mặt trong danh sách `meeting_participants` của cuộc họp, hoặc Admin.

---

## UC-83 — Chỉnh sửa transcript thủ công

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: mỗi lần lưu chỉnh sửa PHẢI ghi một **bản ghi lịch sử phiên bản (Revision Log)** đầy đủ: người sửa, thời gian, **nội dung gốc trước khi sửa**, **nội dung mới sau khi sửa**. BR2: nội dung sau khi sửa PHẢI tự động đồng bộ **real-time** lên màn hình mọi người khác đang mở xem, không cần tải lại trang.

**Code thực tế (bằng chứng):**
- Routes: `PATCH transcripts/:transcriptId/segments` (sửa từng đoạn) và `PATCH transcripts/:transcriptId/content` (ghi đè `rawText`/`cleanedText`), cả hai permission `transcript.update`, chỉ Host của meeting hoặc role Admin — `src/modules/transcription/transcript-segments.controller.ts:43-111`.
- `updateTranscriptSegments()` (`transcription.service.ts:502-622`): sửa **tại chỗ** — `seg.text = item.text` (dòng 572) **ghi đè trực tiếp** lên đối tượng segment cũ trong mảng `segments`, không lưu lại bản sao nội dung cũ ở đâu cả. Chỉ tăng 1 số đếm `editRevisionNo` (dòng 582-583) và ghi `lastRevisionNote` (dòng 590, **ghi đè** — không phải mảng lịch sử, note cũ bị mất khi có note mới). Toàn bộ transcript chỉ giữ 2 field cấp-transcript `editedBy`/`editedAt` (dòng 598-601) — **là bản ghi của lần sửa GẦN NHẤT duy nhất**, không phải nhật ký từng lần sửa.
- Không có bảng/entity revision-history riêng nào trong `src/modules/transcription/entities/` (chỉ có `transcript.entity.ts`) — xác nhận không có nơi lưu trữ "nội dung gốc trước khi sửa" của từng lần chỉnh sửa.
- Grep `emit|WebSocket|Gateway` trong `transcription.service.ts`: **0 kết quả** — không có bất kỳ cơ chế push/broadcast nào sau khi sửa; client khác phải tự gọi lại `GET .../transcript` (poll/refresh thủ công) mới thấy nội dung mới.

**Nhận xét:**
1. BR1 (Revision Log đầy đủ: cũ + mới + người + thời gian cho **mỗi lần sửa**) **không được implement** — code chỉ có 1 bộ đếm (`editRevisionNo`) + thông tin lần sửa gần nhất duy nhất; nội dung phiên bản cũ bị ghi đè và mất vĩnh viễn, không thể tra cứu lại "trước khi sửa là gì".
2. BR2 (đồng bộ real-time không cần tải lại trang) **không được implement** — không có WebSocket/gateway nào được gọi trong service này.
3. Có `revisionNote` (dòng optional trong DTO) nhưng chỉ lưu note của lần sửa cuối, không phải nhật ký từng lần.

**Đề xuất sửa SRS:**
> BR1: Mỗi lần Host/Admin lưu chỉnh sửa, hệ thống chỉ cập nhật 2 field cấp transcript: `editedBy` (người sửa gần nhất) và `editedAt` (thời gian sửa gần nhất), cùng bộ đếm `editRevisionNo` tăng dần. **Nội dung phiên bản trước khi sửa KHÔNG được lưu lại** — không có nhật ký lịch sử đầy đủ (old vs new) cho từng lần sửa; nếu cần tính năng này phải bổ sung bảng revision-history riêng. BR2: Hệ thống **hiện chưa** đồng bộ real-time tới các phiên xem khác đang mở — người xem khác cần tự tải lại (refresh) trang hoặc gọi lại API để thấy nội dung mới nhất.

---

## UC-84 — Bảo mật pipeline xử lý dữ liệu Speech-to-Text (bỏ UC này)

**Trạng thái:** ❌ KHÔNG CÓ CODE

**SRS hiện tại ghi:** Quản trị viên cấu hình chính sách bảo mật STT trên phân hệ Quản trị hệ thống; hệ thống mã hóa tệp âm thanh trên đường truyền trước khi gửi tới Whisper, mã hóa tĩnh khi lưu trữ transcript, áp dụng quy tắc giới hạn quyền truy cập, ghi log bảo mật vào audit log.

**Code thực tế (bằng chứng):** Grep `encrypt|TLS|https|mã hóa` trong toàn bộ `src/modules/transcription/`: **0 kết quả**. Không có màn hình/endpoint cấu hình "chính sách bảo mật STT" nào trong module `administration` hay `transcription`. Việc truyền dữ liệu tới Whisper thực hiện qua hàng đợi nội bộ (`QueueService`/BullMQ) trong cùng hạ tầng backend — không có bước mã hóa/giải mã tường minh nào theo đúng luồng 8 bước SRS mô tả (đóng gói + mã hóa đường truyền → gửi kênh an toàn → nhận → giải mã → mã hóa tĩnh → áp quy tắc → ghi log bảo mật).

**Nhận xét:**
Đây không phải một tính năng nghiệp vụ có API/màn hình riêng như các UC khác trong SRS, mà là các biện pháp bảo mật hạ tầng chung (HTTPS, mã hóa lưu trữ ở tầng storage/infra) — nếu có, chúng áp dụng xuyên suốt toàn hệ thống chứ không phải một luồng nghiệp vụ "Bảo mật pipeline STT" tách biệt như SRS mô tả. Bản thân SRS đã tự đánh dấu UC này là "(bỏ UC này)" ngay trong tiêu đề; kết quả kiểm tra code ủng hộ phương án bỏ, bất chấp ghi chú "Other Information" nói ngược lại.

**Đề xuất sửa SRS:**
> Đề xuất **bỏ UC-84** khỏi danh sách UC nghiệp vụ (đúng như tiêu đề gốc đã tự đánh dấu), vì không tồn tại dưới dạng một tính năng/API/màn hình riêng biệt trong code, và cũng không nên được implement như vậy — các yêu cầu về mã hóa/bảo mật dữ liệu STT nên được xử lý như NFR hạ tầng chung (HTTPS toàn hệ thống, mã hóa tại tầng storage), không cần một luồng nghiệp vụ UC riêng với màn hình cấu hình admin.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Hệ thống "Live Speaker Tagging"** (`src/modules/transcription/live-speaker-tagging.controller.ts`, permission `transcript.speaker_tag`) — cơ chế THẬT để gán tên người nói, hoàn toàn khác "sơ đồ chỗ ngồi tự động" mà SRS mô tả: Host bấm `POST recording/start-marker` để server đóng dấu mốc t=0 lúc bắt đầu ghi âm; trong lúc họp, Host bấm `POST recording/live-speaker-tag` mỗi khi muốn đánh dấu "người này đang nói ngay bây giờ"; có `POST recording/start-marker/manual` dự phòng khi Host quên bấm mốc bắt đầu; và `POST recording-sessions/:sessionId/speaker-marks` để gửi hàng loạt mốc gán tên kèm offset giây (dùng cho trạm ghi âm cố định trong trình duyệt). Các mốc này được `SpeakerMappingService.applySpeakerMappingsFromEvents()` áp ngược lại vào transcript segments sau khi transcript được tạo (`transcription.service.ts:427-441`).
2. **Tự động chọn chế độ xử lý theo số lượng file audio** (`diarization_only` vs `channel_zone`, `transcription.service.ts:165-184`) — chi tiết kiến trúc quan trọng thay thế hoàn toàn khái niệm "Room Capture Agent + seat assignment" của SRS.
3. **`forceRerun`** — cho phép tạo lại job dù đã có 1 job đang `PROCESSING` cho cùng recording session (`transcription.service.ts:192-201`), kèm `versionNo` tăng dần mỗi lần tạo lại (dòng 225).
4. **Notification "Transcript đã sẵn sàng"** gửi in-app cho Host sau khi job hoàn tất (`notifyTranscriptReady()`, dòng 450-494) — không nằm trong postcondition của UC-81.
5. **`TRANSCRIPTION_ENABLED`** — feature-flag tắt/mở toàn bộ tính năng transcription (dòng 88-101) — không có trong SRS.
6. **Workflow trạng thái `draft → reviewed → approved`** (`PATCH transcripts/:transcriptId/status`, `transcript-segments.controller.ts:115-152`; `updateTranscriptStatus()`, `transcription.service.ts:714+`) — một state machine phê duyệt transcript hoàn toàn không được SRS Mục 12 nhắc tới (chỉ ngụ ý gián tiếp qua "Đã kết thúc"/"Đang xử lý"/"Hoàn tất"/"Thất bại"). Chỉ cho chuyển tiến (không lùi về draft), theo comment "Gap fix (Nhóm A)".
7. **Cờ `manualReviewRequired`/`lowConfidence` theo từng segment** (`updateTranscriptResult()`, dòng 393-411) — cơ chế đánh dấu các đoạn AI tự nhận diện có độ tin cậy thấp cần con người rà soát lại — một tầng kiểm soát chất lượng không có trong SRS.
