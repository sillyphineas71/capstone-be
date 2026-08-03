## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-03 | **Sửa FR-015/ERR-007/AC-002/5.3 → all-or-nothing** khi viết plan.md: đọc code thật `createSpeakerMappings()` (GA-20) xác nhận convention validate hàng loạt của service này luôn all-or-nothing (transaction, không ghi một phần) — bản FR-015 gốc "từ chối riêng mốc lỗi" không khớp convention, sửa lại cho nhất quán trước khi implement. | FR-015 (mục 3.5), ERR-007 (mục 6.3), AC-002 (mục 7.2), 5.3 (bỏ `rejectedMarks`) |
| 2026-08-03 | Viết lại toàn bộ `spec.md` đúng cấu trúc `.specify/templates/spec-template.md` (8 mục chuẩn: Context&Goal / Actor&Roles / Functional Requirements / NFR / Data Model / Error Handling / Acceptance Criteria / Out of Scope). Nội dung RECON + lịch sử quyết định D-1..D-8 trước đó được giữ nguyên tại `research.md` (đổi tên từ bản `spec.md` cũ — xem changelog file đó) và được trích dẫn ngược lại từ đây. Không phát sinh quyết định nghiệp vụ mới trong lần viết lại này — chỉ tổ chức lại đúng khuôn spec, cộng 1 điểm mới cần xác nhận (permission cho endpoint mới, mục 2.2). | Toàn bộ file (viết lại theo template) |

> File này là spec chính thức của tính năng — tuân thủ `.specify/templates/spec-template.md`. Toàn bộ RECON file:line, câu hỏi đã hỏi, và log quyết định D-1..D-8 nằm ở [`research.md`](./research.md) cùng thư mục — spec này chỉ trích dẫn kết luận, không lặp lại quá trình suy luận.

---

# Feature Specification: Ghi âm tại trạm cố định trong phòng họp qua trình duyệt (Fixed-Station Browser Recording)

- **Feature ID**: REC-006
- **Feature Name**: PC cố định trong phòng họp + mic hội nghị USB, ghi âm trực tiếp bằng `MediaRecorder` của trình duyệt trong chính app cuộc họp, upload lên hệ thống dùng transcription pipeline có sẵn
- **Module / Domain**: `recording` (thu âm), điểm nối `transcription` (đầu vào pipeline + mốc gán tên) — không sửa `SpeakerMappingService`
- **Created Date**: 2026-08-03
- **Status**: Draft — RECON xong, D-1..D-8 đã chốt với Thiếu Chủ (xem `research.md`), sẵn sàng viết `plan.md` sau khi spec này được duyệt
- **Source Documents**:
  - [`research.md`](./research.md) (RECON file:line đầy đủ + log quyết định D-1..D-8, cùng thư mục)
  - Đề xuất gốc của Thiếu Chủ (chat 2026-08-03) — PC cố định + mic hội nghị + `MediaRecorder` thay điện thoại
  - `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (kế hoạch tổng ghi âm + gán danh tính)
  - `spec/features/transcription/feat-speaker-tagging-live/spec.md` (GIAI ĐOẠN 3 — cơ chế marker hiện có, giữ nguyên không đổi, xem mục 8 Out of Scope)
  - `spec/features/transcription/feat-speaker-tagging-post-meeting/spec.md` (GIAI ĐOẠN 2 — anchor `recording_sessions.started_at` được tái dùng nguyên vẹn ở feature này)
  - `src/modules/recording/controllers/recording-session.controller.ts`, `src/modules/recording/services/recording-session.service.ts`, `src/modules/transcription/speaker-mapping.service.ts`, `src/modules/transcription/dto/create-live-speaker-tag.dto.ts`

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hiện tại, việc đưa audio vào hệ thống hoàn toàn thủ công: Host ghi âm bằng app riêng trên điện thoại/máy ghi âm trong lúc họp, rồi **sau khi họp xong** mới kéo-thả file vào `AudioUploader.jsx` để gọi `POST /meetings/:id/recording-sessions/audio-upload`. Song song, GIAI ĐOẠN 3 (`feat-speaker-tagging-live`, BE xong 2026-08-03) vừa xây cơ chế "marker" để đồng bộ mốc thời gian giữa hai thiết bị tách rời (điện thoại ghi âm và app cuộc họp) — cơ chế này tồn tại **chỉ vì** hai thiết bị có hai đồng hồ độc lập.

Đề xuất trạm cố định (PC + mic hội nghị USB, ghi bằng `MediaRecorder` ngay trong app) loại bỏ nguyên nhân gốc đó: ghi âm và bấm gán tên xảy ra trong **cùng một phiên trình duyệt**, nên không còn cần đồng bộ hai đồng hồ. Chi tiết đối chiếu code thật và toàn bộ quá trình cân nhắc nằm ở `research.md`; feature này hiện thực hoá các quyết định đã chốt ở đó (D-1..D-8).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host (hoặc actor được uỷ quyền) ghi âm cuộc họp trực tiếp trong trình duyệt tại một trạm cố định trong phòng, upload lên hệ thống transcription hiện có, và tuỳ chọn gán tên người nói ngay trong lúc họp — nhằm loại bỏ thao tác thủ công dùng thiết bị ghi âm rời và cơ chế đồng bộ đồng hồ phức tạp mà GIAI ĐOẠN 3 phải dùng cho trường hợp hai thiết bị tách rời.

### 1.3 Giá trị mang lại

- Giảm 1 bước thao tác thủ công (không cần Host tự tay chuyển file từ thiết bị ghi âm sang máy tính rồi upload).
- Loại bỏ toàn bộ lớp phức tạp "đồng bộ 2 mốc thời gian qua `meeting_events`" cho các phòng có trạm cố định.
- Chất lượng âm thanh tốt hơn (mic hội nghị chuyên dụng so với mic điện thoại).
- Dữ liệu không nằm tạm trên thiết bị cá nhân của Host.
- Tận dụng gần như toàn bộ hạ tầng đã có (endpoint `audio-upload`, anchor + logic áp mapping của GIAI ĐOẠN 2) — chỉ thêm đúng 1 endpoint BE mới.

### 1.4 Giả định

Các giả định dưới đây đều đã được xác minh bằng RECON code thật (chi tiết file:line ở `research.md`), không phải suy đoán:

- Endpoint `audio-upload` (`recording-session.controller.ts:126-150`) **trung lập với nguồn gốc file** — không giả định file đến từ điện thoại, chấp nhận `.webm` sẵn (định dạng mặc định `MediaRecorder` xuất ra) — **không cần sửa BE cho luồng upload cơ bản** (research.md D-2).
- `uploadAudioTrack()` (`recording-session.service.ts:949-1005`, cơ chế `audio-tracks` sẵn có) **không dùng được** làm cơ chế chunk-upload cho tính năng này — bị chặn bởi `meeting.status='completed'`, yêu cầu participant, và giới hạn 1 track/người/session (research.md D-3).
- `assertHostOrAdmin()` (`recording-session.service.ts:1112-1137`) chỉ chấp nhận Host-của-đúng-meeting hoặc `BUSINESS_ADMIN`/`SYSTEM_ADMIN` — **tài khoản trạm dùng chung sẽ bị 403** ở mọi lần upload nếu không phải Host (research.md D-6). Feature này giả định Host tự đăng nhập trên trạm mỗi buổi họp.
- `rooms.has_microphone` (`database_v4_current_41_tables.sql:311-313`) đã tồn tại và đã được trả về FE sẵn trong chi tiết cuộc họp (`meetings.controller.ts:738-742`) — dùng làm cờ "phòng có trạm cố định", không cần migration (research.md D-8).
- Với `tagSource='post'` trong `applySpeakerMappingsFromEvents()` (`speaker-mapping.service.ts:604-640`), anchor là `recordingSession.startedAt` và `offsetMs = event.eventTime - anchorMs` — công thức ngược `event_time = startedAt + offsetSeconds` khớp tuyệt đối, cho phép tái dùng logic áp mapping của GIAI ĐOẠN 2 mà không sửa dòng nào (research.md D-4).
- GIAI ĐOẠN 3 (marker, `feat-speaker-tagging-live`) giữ nguyên trong codebase, không xoá — chỉ tạm thời không có FE gọi tới cho phòng có trạm cố định (research.md D-1, mục 8 Out of Scope).

### 1.5 Cần làm rõ

- **Permission cho endpoint mới (mục 2.2)**: đề xuất tái dùng `transcript.speaker_tag` (đã seed 4 role EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN từ GIAI ĐOẠN 2) thay vì seed permission mới — vì cùng bản chất hành vi "gán danh tính người nói". **Chưa được Thiếu Chủ xác nhận trực tiếp**, cần chốt trước khi viết plan.md.
- **RISK-001 (chunk `.webm` không độc lập)**: các đoạn `MediaRecorder` sinh ra khi dùng `timeslice` không độc lập — chỉ đoạn đầu chứa header container, các đoạn sau chỉ là dữ liệu thô. Nối đúng thứ tự thì hợp lệ, nhưng phục hồi sau crash **bắt buộc phải bắt đầu từ đoạn đầu tiên**, không được bỏ sót đoạn nào. Chưa smoke test trên trình duyệt thật của trạm.
- **RISK-002 (thời lượng xử lý AI tăng)**: trạm cố định làm việc ghi trọn buổi trở thành mặc định (RTF ~1.73× — họp 60' → ~1h44 xử lý) — cần lường trước khi demo, không phải rủi ro chặn thiết kế.
- **RISK-003 (quyền mic cần HTTPS)**: `getUserMedia` yêu cầu HTTPS (hoặc `localhost`) — cần xác nhận cách máy trạm truy cập app trước khi lắp đặt thật.
- **Dung lượng file thực tế**: ước tính webm/opus ~90 phút dưới 100MB (trong hạn mức 500MB hiện tại), nhưng chưa đo bằng bản ghi thật trên đúng mic hội nghị sẽ dùng.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host/Organizer | Actor chính | Đăng nhập trên trạm cố định đầu buổi; bấm "Bắt đầu ghi"/"Dừng ghi"; tuỳ chọn bấm gán "người này đang nói" trong lúc họp |
| Business Admin / System Admin | Dự phòng | Có thể thực hiện thay Host với mọi meeting (giống quyền upload audio hiện có) |
| Hệ thống (FE trên trạm) | Actor nội bộ | Ghi âm qua `MediaRecorder`, lưu đoạn xuống IndexedDB, nối file, gọi `audio-upload`, gửi mốc gán tên |
| Hệ thống (BE) | Actor nội bộ | Lưu `recording_sessions`/`media_files` (không đổi so với hiện có), ghi `meeting_events` cho mốc gán tên, tái dùng `applySpeakerMappingsFromEvents()` khi transcript sẵn sàng |

### 2.2 Role & Permission Rules

- Upload audio: dùng nguyên permission `transcript.create` đã có — **không đổi**.
- Endpoint mới nhận mốc gán tên (mục 5.2): đề xuất dùng lại `transcript.speaker_tag` (đã seed đủ 4 role thật từ GIAI ĐOẠN 2) — **chưa chốt chính thức**, xem mục 1.5.
- Không seed permission mới nếu đề xuất trên được chấp nhận (đúng nguyên tắc tránh trùng permission cho cùng một hành vi nghiệp vụ).

### 2.3 Actor Constraints

- User phải đăng nhập.
- Actor gọi endpoint upload hoặc endpoint mốc gán tên phải là Host của đúng meeting đó, HOẶC có role `BUSINESS_ADMIN`/`SYSTEM_ADMIN` (dùng nguyên `assertHostOrAdmin()` hiện có).
- Chức năng ghi âm chỉ hiển thị trên FE khi `rooms.has_microphone = true` cho phòng của meeting đang mở (ràng buộc UX, không phải authorization).

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE FE SHALL cung cấp chức năng ghi âm trực tiếp trong trình duyệt bằng navigator.mediaDevices.getUserMedia({audio:true}) kết hợp MediaRecorder tại trạm cố định — KHÔNG cần app ghi âm ngoài.
FR-002: THE system SHALL tái sử dụng endpoint audio-upload hiện có (POST /meetings/:meetingId/recording-sessions/audio-upload) để nhận file ghi âm từ trình duyệt — KHÔNG tạo endpoint upload mới.
FR-003: THE system SHALL cung cấp một endpoint mới nhận danh sách mốc gán tên kèm offsetSeconds tường minh cho một recording session đã tồn tại (mục 5.2).
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN Host bấm "Dừng ghi", THE FE SHALL nối các đoạn ghi đã lưu trong IndexedDB (mục 3.3) thành một file .webm và gọi endpoint audio-upload.
FR-005: WHEN audio-upload trả về recordingSessionId thành công, THE FE SHALL gửi ngay danh sách mốc gán tên đã thu thập trong lúc họp (nếu có) tới endpoint FR-003, kèm recordingSessionId vừa nhận được.
FR-006: WHEN endpoint FR-003 nhận một mốc gán tên hợp lệ, THE system SHALL ghi một bản ghi meeting_events (event_type='speaker_tag', metadata_json.tagSource='post') với event_time = recording_sessions.started_at + offsetSeconds.
FR-007: WHEN Host bấm gán "người này đang nói" trong lúc đang ghi, THE FE SHALL tự tính offsetSeconds kể từ lúc bắt đầu ghi bằng đồng hồ trình duyệt cục bộ và lưu vào cùng bản ghi IndexedDB với audio.
```

### 3.3 State-driven Requirements

```text
FR-008: WHILE đang ghi, THE FE SHALL cắt đoạn ghi định kỳ (đề xuất ~30-60 giây) và lưu ngay từng đoạn xuống IndexedDB thay vì tích luỹ toàn bộ trong bộ nhớ RAM của tab.
FR-009: WHILE một phiên ghi trong IndexedDB chưa upload thành công, THE FE SHALL giữ nguyên dữ liệu đó để có thể phục hồi ở lần mở app kế tiếp trên cùng trạm.
```

### 3.4 Optional Feature Requirements

```text
FR-010: WHERE phòng họp của meeting có rooms.has_microphone = true, THE FE SHALL hiển thị chức năng "Bắt đầu ghi"/"Dừng ghi" trên trang họp.
FR-011: WHERE trình duyệt/thiết bị KHÔNG hỗ trợ MediaRecorder hoặc IndexedDB, THE FE SHALL ẩn chức năng ghi âm trực tiếp và chỉ hiển thị luồng upload file đã ghi sẵn hiện có (AudioUploader.jsx).
```

### 3.5 Unwanted Behavior Requirements

```text
FR-012: IF trình duyệt từ chối quyền truy cập microphone, THEN THE FE SHALL báo lỗi rõ ràng cho Host và KHÔNG chặn luồng upload file đã ghi sẵn hiện có.
FR-013: IF actor gọi endpoint FR-003 mà không phải Host của đúng meeting và không có role BUSINESS_ADMIN/SYSTEM_ADMIN, THEN THE system SHALL từ chối với lỗi phân quyền, không ghi dữ liệu.
FR-014: IF recordingSessionId truyền vào endpoint FR-003 không tồn tại hoặc không thuộc đúng meetingId, THEN THE system SHALL từ chối yêu cầu và KHÔNG ghi meeting_events.
FR-015: IF bất kỳ offsetSeconds nào trong yêu cầu nhỏ hơn 0 hoặc lớn hơn duration_seconds của recording session, THEN THE system SHALL từ chối TOÀN BỘ yêu cầu (all-or-nothing), KHÔNG ghi một phần vào meeting_events — đúng convention validate all-or-nothing đã dùng ở `createSpeakerMappings()` (GA-20, GIAI ĐOẠN 2) cho cùng loại thao tác gán tên hàng loạt.
```

### 3.6 Traceability

| Requirement ID | EARS Pattern | Nguồn / Quyết định liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Đề xuất gốc Thiếu Chủ | Thay thế ghi âm bằng thiết bị rời |
| FR-002 | Ubiquitous | research.md D-2 | Không sửa endpoint upload |
| FR-003, FR-006 | Ubiquitous / Event-driven | research.md D-4 | Endpoint mới, anchor GIAI ĐOẠN 2 |
| FR-004, FR-005, FR-007 | Event-driven | research.md D-2, D-4, D-5 | Luồng dừng ghi → upload → gửi mốc |
| FR-008, FR-009 | State-driven | research.md D-2, D-5 | IndexedDB, chống mất dữ liệu |
| FR-010 | Optional Feature | research.md D-8 | Cờ `rooms.has_microphone` |
| FR-011, FR-012 | Optional Feature / Unwanted | Đề xuất gốc mục 4 | Fallback luôn còn AudioUploader |
| FR-013 | Unwanted Behavior | research.md D-6, `assertHostOrAdmin` | Tái dùng nguyên phân quyền hiện có |
| FR-014, FR-015 | Unwanted Behavior | Suy ra từ D-4 (offset phải khớp file thật) | Chưa có tiền lệ code, cần plan.md thiết kế chi tiết |

---

## 4. Non-functional Requirements

### 4.2 Security

```text
NFR-001: THE system SHALL yêu cầu authentication (JwtAuthGuard) và permission phù hợp (mục 2.2) cho endpoint mới trước khi ghi bất kỳ meeting_events nào.
NFR-002: THE system SHALL NOT log nội dung audio hoặc payload mốc gán tên chứa dữ liệu cá nhân ngoài mức cần thiết cho chẩn đoán lỗi.
```

### 4.3 Reliability & Consistency

```text
NFR-003: WHEN phục hồi một phiên ghi dang dở từ IndexedDB, THE FE SHALL luôn bắt đầu từ đoạn ghi đầu tiên và không được bỏ sót đoạn nào (RISK-001, mục 1.5).
NFR-004: IF upload audio thất bại (lỗi mạng/server), THEN THE FE SHALL giữ nguyên dữ liệu trong IndexedDB để thử lại, KHÔNG xoá cho tới khi upload được xác nhận thành công.
NFR-005: THE system SHALL đảm bảo việc ghi mốc gán tên (FR-006) không làm thay đổi hành vi của applySpeakerMappingsFromEvents() cho các sự kiện tagSource='post' đã tồn tại từ GIAI ĐOẠN 2 (không có regression).
```

### 4.6 Maintainability

```text
NFR-006: THE system SHALL NOT thêm bảng hoặc cột database mới cho tính năng này (DATA-01) — dùng nguyên recording_sessions, media_files, meeting_events, rooms.has_microphone hiện có.
NFR-007: THE endpoint mới (FR-003) SHALL KHÔNG sửa đổi SpeakerMappingService hay logic quy chiếu/mâu thuẫn đã verify thật ở GIAI ĐOẠN 2.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `recording_sessions` | Dùng nguyên như luồng `audio-upload` hiện có — không đổi cấu trúc/logic tạo | `started_at` dùng làm anchor cho FR-006 |
| `media_files` | Dùng nguyên — không đổi | |
| `meeting_events` | Ghi thêm bản ghi `event_type='speaker_tag'`, `metadata_json.tagSource='post'` qua endpoint mới | Đúng shape GIAI ĐOẠN 2 đã có, không thêm cột |
| `rooms` | Đọc `has_microphone` (đã có) để quyết định hiển thị UI — READ-ONLY, không ghi | Không migration |

### 5.2 Dữ liệu đầu vào — endpoint mới (đề xuất route `POST /meetings/:meetingId/recording-sessions/:sessionId/speaker-marks`)

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `marks` | array | Có | Danh sách mốc gán tên | Tối thiểu 1 phần tử |
| `marks[].offsetSeconds` | number | Có | Giây tính từ lúc bắt đầu ghi | `>= 0`, `<= duration_seconds` của session (FR-015) |
| `marks[].speakerUserId` | uuid | Không | Map tới user hệ thống | Giống `CreateLiveSpeakerTagDto` hiện có |
| `marks[].externalParticipantId` | uuid | Không | Map tới khách ngoài công ty | Giống `CreateLiveSpeakerTagDto` hiện có |
| `marks[].displayName` | string | Có | Tên hiển thị | 1-255 ký tự, giống `CreateLiveSpeakerTagDto` hiện có |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| `savedCount` | number | Số mốc được ghi thành công (all-or-nothing — bằng đúng `marks.length` nếu request không bị từ chối) |

### 5.4 State / Status Model

Tính năng này **không thêm state/status mới** — `recording_sessions.status` vẫn theo đúng vòng đời hiện có của luồng `audio-upload` (tạo thẳng ở `stopped`, không có state ghi-âm-đang-diễn-ra ở phía BE vì toàn bộ việc ghi diễn ra phía client trước khi upload).

### 5.5 Data Constraints

- Không thêm bảng, không thêm cột database (NFR-006).
- `offsetSeconds` phải nằm trong khoảng thời lượng thật của file audio đã upload (FR-015) — validate SAU khi đã có `duration_seconds` từ `probeUploadedAudioDuration()`.
- Payload mốc gán tên chỉ được chấp nhận cho `recordingSessionId` thuộc đúng `meetingId` trong URL (FR-014).

### 5.6 Data Lifecycle

- Đoạn ghi + mốc gán tên: tồn tại tạm trong IndexedDB phía trình duyệt trong lúc họp và tới khi upload thành công.
- Sau khi `audio-upload` thành công và endpoint mới ghi xong `meeting_events`: dữ liệu IndexedDB có thể xoá (theo NFR-004, chỉ xoá sau khi xác nhận thành công).
- `meeting_events` được tạo bởi tính năng này sống độc lập, được đọc lại bởi `applySpeakerMappingsFromEvents()` mỗi khi transcript được tạo/chạy lại — không có TTL riêng, theo đúng vòng đời `meeting_events` hiện có.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN endpoint mới ghi một mốc gán tên hợp lệ, THE system SHALL persist đúng meetingId, recordingSessionId (qua metadata_json), offsetSeconds đã quy đổi thành event_time, và danh tính (speakerUserId hoặc externalParticipantId hoặc displayName).
FR-DATA-002: IF recordingSessionId không tồn tại hoặc không thuộc meetingId, THEN THE system SHALL từ chối toàn bộ yêu cầu (không ghi một phần).
```

### 5.8 Cần làm rõ

- Shape chính xác của `rejectedMarks` (mục 5.3) — để plan.md quyết định, không phải quyết định nghiệp vụ.
- Route path chính xác của endpoint mới — mục 5.2 chỉ là đề xuất, cần xác nhận ở plan.md có tuân đúng convention `/api/v1/...` của dự án hay điều chỉnh.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `marks` rỗng hoặc thiếu, THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation.
ERR-002: IF `marks[].offsetSeconds` không phải số hoặc âm, THEN THE system SHALL từ chối riêng mốc đó (FR-015).
ERR-003: IF `marks[].displayName` rỗng hoặc vượt 255 ký tự, THEN THE system SHALL từ chối riêng mốc đó.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-004: IF user chưa đăng nhập, THEN THE system SHALL trả lỗi xác thực (401).
ERR-005: IF user không phải Host của đúng meeting và không có role BUSINESS_ADMIN/SYSTEM_ADMIN, THEN THE system SHALL trả lỗi phân quyền (403) — FR-013.
```

### 6.3 Business Rule Errors

```text
ERR-006: IF recordingSessionId không tồn tại hoặc không thuộc đúng meetingId, THEN THE system SHALL từ chối yêu cầu (FR-014).
ERR-007: IF bất kỳ offsetSeconds nào vượt quá duration_seconds thật của file audio đã upload, THEN THE system SHALL từ chối TOÀN BỘ yêu cầu, không ghi phần nào (FR-015, all-or-nothing).
```

### 6.4 Conflict Errors

Không áp dụng cho tính năng này — endpoint mới chỉ thêm bản ghi `meeting_events`, không có ràng buộc unique/conflict nào phát sinh.

### 6.5 Integration / Device / External Service Errors

```text
ERR-008: IF trình duyệt từ chối quyền microphone hoặc không hỗ trợ MediaRecorder/IndexedDB, THEN THE FE SHALL báo lỗi rõ ràng và chuyển về luồng upload file đã ghi sẵn (FR-011, FR-012).
ERR-009: IF upload audio thất bại giữa chừng (mạng/server), THEN THE FE SHALL giữ nguyên dữ liệu IndexedDB và cho phép Host thử lại (NFR-004).
```

### 6.6 Error Response Expectations

Theo đúng convention lỗi chuẩn hoá của dự án (mục 8.2 `CLAUDE.md`) — `success:false`, `message`, `error.code`, `error.details`, `timestamp`, `path`. Không định nghĩa format riêng cho feature này.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given phòng họp có rooms.has_microphone=true và Host đã đăng nhập trên trạm cố định,
When Host bấm "Bắt đầu ghi", ghi âm một lúc, tuỳ chọn bấm gán tên vài lần, rồi bấm "Dừng ghi",
Then FE upload file audio thành công qua audio-upload, gửi các mốc gán tên qua endpoint mới thành công,
  và khi transcript của recording session đó được tạo, các mốc gán tên tự động áp đúng vào transcript
  qua applySpeakerMappingsFromEvents() (không cần thao tác gán lại).
```

### 7.2 Validation Cases

```text
AC-002:
Given một yêu cầu có 3 mốc gán tên, trong đó 1 mốc có offsetSeconds = -5,
When FE gửi tới endpoint mới,
Then hệ thống từ chối TOÀN BỘ yêu cầu (all-or-nothing), không ghi cả 3 mốc — kể cả 2 mốc hợp lệ còn lại.
```

### 7.3 Authorization Cases

```text
AC-003:
Given user không phải Host của meeting và không có role BUSINESS_ADMIN/SYSTEM_ADMIN,
When user gọi endpoint mới,
Then hệ thống từ chối với lỗi phân quyền và không ghi dữ liệu.
```

### 7.4 Business Rule Cases

```text
AC-004:
Given recordingSessionId không thuộc meetingId trong URL,
When gọi endpoint mới,
Then hệ thống từ chối toàn bộ yêu cầu, không ghi một phần nào.
```

### 7.5 Reliability Case (đặc thù feature — thay cho State Transition Case)

```text
AC-005:
Given trạm cố định bị mất điện/crash giữa buổi họp trong khi vẫn còn dữ liệu chưa upload trong IndexedDB,
When Host mở lại app trên cùng trạm,
Then FE đề nghị phục hồi, nối đúng thứ tự TỪ ĐOẠN ĐẦU TIÊN, và cho phép Host tiếp tục upload bù.
```

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001..FR-007 | Luồng đầy đủ ghi → upload → gán tên → áp mapping tự động |
| AC-002 | FR-015, ERR-002 | Validation offsetSeconds âm |
| AC-003 | FR-013, ERR-005 | Phân quyền endpoint mới |
| AC-004 | FR-014, ERR-006 | recordingSessionId sai meeting |
| AC-005 | FR-008, FR-009, NFR-003 | Phục hồi IndexedDB sau crash |

---

## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Thay đổi/xoá cơ chế marker của GIAI ĐOẠN 3 (`feat-speaker-tagging-live`, GA-30/32/35) — giữ nguyên trong codebase (research.md D-1).
- Thiết kế/mua sắm phần cứng (loại mic cụ thể, vị trí đặt, model PC).
- Chunk-upload lên server trong lúc họp (đã cân nhắc và loại bỏ ở research.md D-2/D-3, dùng IndexedDB phía client thay thế).
- Real-time streaming audio lên server (WebSocket/RTC) trong lúc họp.
- Thay đổi giao diện AI Summarize/transcript review.
- Thay đổi database schema — không thêm bảng/cột.
- Thiết kế lại toàn bộ trang quản lý phòng chỉ vì cần bật `has_microphone` — dùng đúng màn hình quản lý phòng hiện có.

### 8.1 Không triển khai trong feature này

- Không implement lại `SpeakerMappingService`/`applySpeakerMappingsFromEvents()`.
- Không sửa `assertHostOrAdmin()` hay bất kỳ cơ chế phân quyền hiện có nào.
- Không tạo tài khoản "trạm" dùng chung (research.md D-6).

### 8.2 Có thể xem xét ở feature khác

- Kích hoạt lại FE cho marker GIAI ĐOẠN 3 nếu sau này vẫn cần gán-tên-trực-tiếp cho phòng chưa có trạm cố định.
- Chuyển sang chunk-upload lên server nếu smoke test IndexedDB (RISK-001) cho kết quả không đủ tin cậy.
- Đăng nhập nhanh/QR cho trạm cố định nếu thao tác đăng nhập mỗi buổi (D-6) gây phiền trong vận hành thật.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT xoá hoặc vô hiệu hoá 3 endpoint marker của GIAI ĐOẠN 3 (start-marker, live-speaker-tag, start-marker/manual) như một phần của feature này.
OOS-002: THE system SHALL NOT tạo bảng hoặc cột database mới cho feature này.
OOS-003: WHERE phần cứng (PC/mic) được nhắc tới, THE system SHALL NOT coi đó là một phần triển khai của spec này — chỉ là tiền đề vận hành.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh: `THE system SHALL`, `WHEN`, `WHILE`, `WHERE`, `IF`, `THEN`.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation (route endpoint mới chỉ là đề xuất, chưa chốt ở mục 5.8).
- [x] Không tự ý thêm feature ngoài tài liệu nguồn — mọi quyết định đều trace về research.md D-1..D-8.
- [x] Không tự ý thêm database table/field mới (NFR-006, OOS-002).
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, integration/device failure.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng (đặc biệt: KHÔNG đụng GIAI ĐOẠN 3).
- [x] Các phần thiếu thông tin đã được đưa vào `Cần làm rõ` (mục 1.5, 5.8) — quan trọng nhất: permission cho endpoint mới CHƯA được Thiếu Chủ xác nhận trực tiếp.

---

> Trạng thái: **CHỜ DUYỆT**. Chưa plan/tasks/code, chưa sửa dòng code nào của dự án. Việc tiếp theo: Thiếu Chủ xác nhận điểm còn mở ở mục 1.5 (permission `transcript.speaker_tag` cho endpoint mới), sau đó viết `plan.md`.
