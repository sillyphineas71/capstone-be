## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo spec.md ban đầu — GIAI ĐOẠN 2 của `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (GA-20→GA-27, bao gồm GA-27 do agent bổ sung ở phiên P0 vì plan gốc thiết kế `meeting_events` làm nguồn sự thật nhưng chưa gán mã task nào cho bước "áp lại tự động khi rerun"). | Toàn bộ file (mới) |

> File này là tài liệu documentation-first, **chưa code**. Nguồn quyết định gốc: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục 3 (quyết định #2,3,8,9,10,11), mục 4 (kiến trúc `meeting_events`), mục 6.2 (việc #5,6,7,8), GIAI ĐOẠN 2, mục 8.1, mục 12 (DoD). Đối chiếu code thật: `transcription.service.ts`, `transcript-segments.controller.ts`, `meeting-event.entity.ts`, `transcript.entity.ts`, `recording-session.entity.ts`, `meeting-external-participant.entity.ts`, migration mẫu `20260729000002-SeedAvatarPhotoUpdatePermission.ts`.

---

# Feature Specification: Speaker Tagging — Post-Meeting (gán danh tính người nói sau buổi họp)

- **Feature ID**: TRANS-SPEAKER-TAG-POST-001
- **Feature Name**: Gán tên thật cho các cụm giọng (`Speaker_N`) sau khi cuộc họp kết thúc, gán hàng loạt theo cụm thay vì từng câu, tự động áp lại khi transcript được tạo lại
- **Module / Domain**: `transcription` (đọc/ghi `transcripts`), `meetings` (ghi `meeting_events`), phụ thuộc `recording` (đọc `recording_sessions`) — không tạo module mới
- **Created Date**: 2026-08-02
- **Status**: Draft
- **Source Documents**:
  - `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (mục 3, 4, 6.2, GIAI ĐOẠN 2, 8.1, 12)
  - `spec/features/transcription/feat-offline-local-transcription-pipeline/spec.md` (feature nền — `transcripts.detected_speakers_json`, `transcripts.speaker_segments_json`)
  - `src/modules/transcription/transcription.service.ts` (pattern authz Host/Admin đã có 6+ chỗ, `updateTranscriptResult()`)
  - `src/modules/transcription/transcript-segments.controller.ts` (pattern controller/DTO/permission)
  - `src/modules/meetings/entities/meeting-event.entity.ts`
  - `src/modules/recording/entities/recording-session.entity.ts`
  - `src/modules/meetings/entities/meeting-external-participant.entity.ts`
  - `src/database/migrations/20260729000002-SeedAvatarPhotoUpdatePermission.ts` (mẫu migration seed permission)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Sau GIAI ĐOẠN 1 (`feat-transcript-segment-merge`, đã xong 2026-08-02), transcript có các cụm giọng `Speaker_N` do pyannote diarization phát hiện, nhưng **không có tên thật** — chỉ có nhãn ẩn danh. Cơ chế sửa tay hiện có (`PATCH /transcripts/:transcriptId/segments`, UC-127) chỉ cho sửa **từng segment một**, không phù hợp khi Host muốn gán "Speaker_1 = anh Nam" cho toàn bộ ~13 segment của người đó cùng lúc.

Vấn đề kỹ thuật cốt lõi: `transcription.service.ts` (dòng 182 khu vực tạo job) tạo **transcript MỚI** (`version_no` tăng) mỗi khi chạy lại transcription cho cùng recording session — không ghi đè bản cũ. Nếu lưu tên đã gán trực tiếp vào `detected_speakers_json` của transcript, mọi lần chạy lại (ví dụ Host chỉnh sửa VAD/model sau này, hoặc retry lỗi) sẽ **xoá sạch công gán tay**. Giải pháp đã chốt trong plan tổng: dùng bảng có sẵn `meeting_events` (event_type mới `speaker_tag`) làm nguồn sự thật độc lập với transcript, gán lại kết quả vào segment **mỗi lần** có transcript mới (xem mục 4).

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host/Organizer (hoặc Business Admin/System Admin dự phòng) của một cuộc họp, sau khi transcript đã có (`status=draft`), xem danh sách các cụm giọng đã phát hiện kèm thời lượng nói, và gán tên thật (user hệ thống hoặc khách ngoài công ty) cho từng cụm **theo lô** (một lần cho cả cụm, không phải từng câu), sao cho việc gán này **sống sót qua mọi lần chạy lại transcription** cho cùng recording session.

### 1.3 Giá trị mang lại

- Cho Host: gán tên chỉ vài thao tác (chọn cụm → chọn người) thay vì sửa hàng chục segment.
- Cho dữ liệu: biên bản có tên người nói thật, phục vụ AI Summarize và tra cứu sau này.
- Cho vận hành: chạy lại transcription (đổi model, sửa lỗi, tinh chỉnh pipeline) không làm mất công gán tay đã làm trước đó.
- Cho khách ngoài công ty: vẫn gán được tên hiển thị dù không có tài khoản hệ thống.

### 1.4 Giả định

- `DIARIZATION_ENABLED=true` đã bật thật (P0, 2026-08-02) — transcript có `Speaker_N` thay vì `unknown` toàn bộ (với điều kiện diarization thành công).
- Bước gộp mảnh (`feat-transcript-segment-merge`, đã xong) đã chạy — nghĩa là "segment" trong `speaker_segments_json.segments` ở feature này gần với "lượt nói" thật hơn baseline gốc.
- `meeting_events.event_type` là `varchar(60)`, **không phải PostgreSQL enum thật** — thêm giá trị `speaker_tag` KHÔNG cần `ALTER TYPE`, chỉ cần migration tài liệu hoá (đúng tiền lệ `20260617-UpdateMeetingEventTypeEnum.ts`).
- `recording_sessions.started_at` hiện tại được server set bằng `new Date()` **tại thời điểm API tạo/upload session được gọi** (`recording-session.service.ts` dòng 161/724/872) — **KHÔNG phải mốc t=0 thật của audio**. Feature này (chỉ gán SAU buổi họp) không cần `started_at` là t=0 thật — xem mục 4.3 để hiểu vì sao round-trip vẫn đúng dù giá trị này là "tuỳ ý nhưng ổn định". Việc làm cho `started_at` phản ánh t=0 thật là phạm vi của GIAI ĐOẠN 3 (`GA-30`/`GA-31`, feature khác), **không phải phạm vi feature này**.
- Endpoint sửa từng segment (`PATCH /transcripts/:transcriptId/segments`, UC-127) đã hỗ trợ sẵn field `speakerUserId` per-segment — feature này **bổ sung** thao tác gán hàng loạt theo cụm, không thay thế endpoint đó.
- `meeting_external_participants` đã có sẵn (bảng baseline, `id` UUID PK, `fullName`) — dùng làm đích tham chiếu cho khách ngoài công ty, không tạo bảng/cột mới.

### 1.5 Cần làm rõ

- **CLR-001 (R8 trong plan tổng — ĐÃ GIẢI qua thiết kế endpoint)**: Endpoint nhận `:transcriptId` cụ thể (giống hệt pattern `PATCH /transcripts/:transcriptId/segments` đã có), **không** tự suy luận "bản mới nhất". Host/FE luôn thao tác trên một `transcriptId` họ đang xem — loại bỏ hoàn toàn sự mơ hồ "áp vào bản nào" vì Host chọn rõ ràng qua URL, đúng như UC-127 đã làm. Đa phiên bản `draft` song song (nếu có) không phải vấn đề của feature này.
- **CLR-002**: "Mốc đại diện của cụm" (plan tổng mục 4.1) được diễn giải thành **segment dài nhất (theo `endMs - startMs`) trong số các segment có `speakerLabel` = cụm đang gán**, lấy điểm giữa segment đó — vì hệ thống hiện tại chỉ lưu `segments` (đã qua bước gộp `feat-transcript-segment-merge`) trong `speaker_segments_json`, **không lưu turn diarization thô riêng lẻ nào sau khi job kết thúc**. Diễn giải này gần nhất với ý "lượt nói dài nhất" của plan tổng mà vẫn dùng được dữ liệu đã có, không cần lưu thêm gì.
- **CLR-003**: Khi gán `speakerUserId`, feature này **không** bắt buộc người đó phải là `meeting_participants` hợp lệ của cuộc họp — Host có thể gán bất kỳ user hệ thống nào tồn tại (ví dụ trợ lý ghi biên bản hộ, hoặc người tham gia không được mời chính thức nhưng có mặt). Chỉ validate user tồn tại (FK safety), không validate tư cách participant. Nếu team muốn siết chặt hơn (chỉ cho gán participant), cần xác nhận lại.
- **CLR-004**: Khi GA-27 (áp lại tự động lúc rerun) không tìm được segment nào chứa mốc đại diện đã lưu trong transcript MỚI (ví dụ ranh giới segment đổi nhiều do đổi model/tham số), hệ thống **không báo lỗi/crash** — coi mapping đó là "không áp lại được", giữ segment ở `unknown`, KHÔNG tự đoán gán bừa (nhất quán với quyết định #9 "không đoán"). Host cần gán lại thủ công cho lần chạy đó.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host/Organizer cuộc họp | Actor chính | Xem danh sách cụm giọng, gán tên hàng loạt cho cụm của meeting mình tổ chức |
| Business Admin | Dự phòng theo quyết định #3 (plan tổng) | Giống Host, không giới hạn theo meeting cụ thể |
| System Admin | Dự phòng | Giống Business Admin |
| Participant thường | Không có quyền gán | Chỉ xem transcript như hiện tại (`transcript.read`), không gọi được endpoint gán |
| Hệ thống (worker AI, khi chạy lại transcription) | Actor nội bộ, không phải người dùng | Tự động đọc `meeting_events` và áp lại mapping vào transcript mới (GA-27), không cần authz vì chạy trong tiến trình backend |

### 2.2 Role & Permission Rules

- Permission mới: `transcript.speaker_tag` — **seed bằng migration**, KHÔNG dùng thư mục `seeds/` (đã bị 403 nhiều lần theo ghi chú CLAUDE.md/memory dự án — thư mục đó không có trình chạy).
- Gán quyền cho role: `MANAGER` (Host thường là Manager hoặc Employee được gán làm host của meeting cụ thể — quyền thật sự siết ở tầng business rule Host-of-meeting, không phải role), `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. **Không gán cho `EMPLOYEE`** mặc định — Employee chỉ có quyền này khi đang là Host của đúng meeting đó, kiểm tra ở service (giống pattern `updateTranscriptSegments` hiện có: permission node là gate thô cấp role, business rule Host-of-meeting siết chặt hơn trong service).

  > Ghi chú: đối chiếu lại role thật trong hệ thống trước khi seed — theo pattern migration mẫu, vai trò "nhân viên" dùng `role_code='EMPLOYEE'`. Vì Host của một meeting cụ thể **có thể là EMPLOYEE bình thường** (bất kỳ ai được set `participant_role='host'`), permission `transcript.speaker_tag` **PHẢI seed cho cả `EMPLOYEE`** (không chỉ MANAGER/ADMIN) — nếu không sẽ 403 với các Host là nhân viên thường, đúng loại lỗi đã bị bắt gặp nhiều lần trong dự án (xem GA-25 acceptance criteria).
- Endpoint đọc danh sách cụm (`GET .../speaker-clusters`) dùng permission đọc đã có `transcript.read`, không cần permission mới riêng — chỉ endpoint GHI (`POST .../speaker-mappings`) cần `transcript.speaker_tag`.

### 2.3 Actor Constraints

- User phải đăng nhập (JWT hợp lệ).
- User phải có permission `transcript.speaker_tag` (gate thô) VÀ (là Host của đúng meeting chứa transcript đó HOẶC có role BUSINESS_ADMIN/SYSTEM_ADMIN) — đúng pattern `isAdminRole()` + kiểm tra `meeting_participants.participant_role='host'` đã dùng lặp lại trong `transcription.service.ts`.
- Transcript phải tồn tại và có `recording_session_id` không null (transcript tạo qua channel_zone mode hiếm khi thiếu, nhưng phải validate — không có recording session thì không tính được mốc đại diện quy về audio).

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cung cấp endpoint gán tên hàng loạt cho cụm giọng: POST /api/v1/transcripts/:transcriptId/speaker-mappings, nhận danh sách { speakerLabel, speakerUserId?, externalParticipantId?, displayName }.
FR-002: THE system SHALL cung cấp endpoint đọc danh sách cụm giọng đã phát hiện: GET /api/v1/transcripts/:transcriptId/speaker-clusters, trả về mỗi cụm kèm tổng thời lượng nói, số segment, và mốc thời gian mẫu để nghe thử.
FR-003: THE system SHALL lưu mọi lần gán (cả hàng loạt lẫn từng câu) dưới dạng bản ghi `meeting_events` với `event_type='speaker_tag'`, độc lập với transcript hiện tại — không lưu mapping CHỈ trong `transcripts.detected_speakers_json`.
FR-004: WHEN transcription được chạy lại cho cùng recording session (tạo transcript mới, version_no tăng), THE system SHALL tự động đọc lại toàn bộ `meeting_events` loại `speaker_tag` liên quan và áp lại mapping vào transcript mới, không cần Host thao tác lại.
```

### 3.2 Event-driven Requirements

```text
FR-005: WHEN Host/Admin gửi yêu cầu gán hàng loạt hợp lệ, THE system SHALL tính mốc đại diện cho từng cụm (điểm giữa segment dài nhất thuộc cụm đó, CLR-002), quy đổi thành `event_time` tuyệt đối bằng `recording_sessions.started_at + mốc đại diện`, và ghi một bản ghi `meeting_events` cho mỗi mapping với `metadata_json = { recordingSessionId, speakerUserId?, externalParticipantId?, displayName, tagSource: 'post' }`.
FR-006: WHEN mapping được ghi thành công vào `meeting_events`, THE system SHALL áp ngay lập tức mapping đó vào TRANSCRIPT HIỆN TẠI (không chờ lần chạy lại tiếp theo) — cập nhật `speaker_segments_json.segments[].speakerUserId`/`speakerLabel` hiển thị và `detected_speakers_json.speakers[].mappedUserId`/`mappingSource='manual'` cho mọi segment thuộc cụm đó.
FR-007: WHEN một transcript mới được tạo cho cùng recording session (chạy lại), THE system SHALL, ngay sau bước ghi kết quả pipeline vào transcript (draft), tự động chạy lại toàn bộ logic áp mapping từ `meeting_events` (GA-27) trước khi coi job hoàn tất.
```

### 3.3 State-driven Requirements

```text
FR-008: WHILE transcript đang ở trạng thái `processing`, THE system SHALL từ chối yêu cầu gán hàng loạt (chưa có segment để gán) — phải đợi transcript sang `draft`.
FR-009: WHILE một `speakerLabel` đã có mapping từ trước (từ lần gán khác hoặc từ meeting_events cũ), THE system SHALL cho phép GHI ĐÈ bằng mapping mới trong cùng request — Host luôn có quyền sửa lại quyết định gán trước đó.
```

### 3.4 Optional Feature Requirements

```text
FR-010: WHERE mapping nhắm tới khách ngoài công ty (externalParticipantId thay vì speakerUserId), THE system SHALL validate externalParticipantId thuộc đúng meeting của transcript đó (join `meeting_external_participants.meeting_id`), không cho gán khách của meeting khác.
```

### 3.5 Unwanted Behavior Requirements

```text
ERR-TAG-001: IF trong CÙNG một request, hai speakerLabel khác nhau được gán cho CÙNG một speakerUserId/externalParticipantId, THEN THE system SHALL chấp nhận và GỘP — áp cùng một identity cho cả hai cụm (quyết định #9 "một người nhiều cụm → gộp", an toàn tuyệt đối vì chỉ làm đúng thêm).
ERR-TAG-002: IF trong CÙNG một request, cùng một speakerLabel xuất hiện nhiều lần với speakerUserId/externalParticipantId KHÁC NHAU, THEN THE system SHALL từ chối toàn bộ request (400) và không ghi bất kỳ mapping nào — không tự chọn "lấy cái sau cùng" hay đoán.
ERR-TAG-003 (GA-27, quan trọng — quyết định #9): IF khi áp lại mapping vào transcript MỚI, hai `meeting_events` khác nhau (đại diện hai người khác nhau) đều quy chiếu vào CÙNG một speakerLabel của lần chạy mới, THEN THE system SHALL đánh dấu cụm đó là mâu thuẫn (`mappingSource='conflict'`, giữ `speakerLabel` gốc dạng `Speaker_N` KHÔNG gán tên, `manualReviewRequired=true`), KHÔNG áp dụng bất kỳ mapping nào cho cụm đó, và KHÔNG suy luận theo "nhiều lần hơn" hay "gần nhất".
ERR-TAG-004: IF `speakerLabel` trong request không tồn tại trong `speaker_segments_json.segments` hiện tại của transcript (ví dụ Host gõ nhầm, hoặc cụm đã đổi số sau lần chạy khác), THEN THE system SHALL từ chối riêng mapping đó (400, liệt kê rõ label không hợp lệ) mà không ghi các mapping hợp lệ khác trong cùng request — all-or-nothing giống `UpdateTranscriptSegmentsDto` (UC-127) đã làm.
ERR-TAG-005: IF cả `speakerUserId` và `externalParticipantId` đều được set (hoặc đều thiếu) trong cùng một mapping item, THEN THE system SHALL từ chối request — bắt buộc chọn ĐÚNG MỘT trong hai.
ERR-TAG-006: IF actor không phải Host của meeting và không có role BUSINESS_ADMIN/SYSTEM_ADMIN, THEN THE system SHALL từ chối với 403, không tiết lộ nội dung transcript.
ERR-TAG-007 (GA-27): IF mốc đại diện đã lưu trong `meeting_events` không rơi vào bất kỳ segment nào của transcript MỚI (ranh giới đổi khác do chạy lại), THEN THE system SHALL bỏ qua việc áp mapping đó cho lần chạy này (không crash, không đoán segment gần nhất) — CLR-004.
```

### 3.6 Traceability

| Requirement ID | EARS Pattern | Nguồn | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | GA-20 | Endpoint chính |
| FR-002 | Ubiquitous | GA-23 | Endpoint đọc cụm |
| FR-003, FR-005 | Event-driven | mục 4.1, GA-21 | Nguồn sự thật `meeting_events` |
| FR-004, FR-007 | Event-driven | GA-27 (agent bổ sung) | Áp lại tự động khi rerun |
| FR-006 | Event-driven | GA-22 | Áp ngay lập tức, không chờ rerun |
| ERR-TAG-001 | Unwanted Behavior | Quyết định #9 (gộp) | An toàn tuyệt đối |
| ERR-TAG-002, ERR-TAG-003 | Unwanted Behavior | Quyết định #9 (mâu thuẫn) | KHÔNG đoán |
| ERR-TAG-007 | Unwanted Behavior | CLR-004 | An toàn khi rerun đổi ranh giới |

---

## 4. Non-functional Requirements

### 4.1 Security

```text
NFR-001: THE system SHALL enforce permission transcript.speaker_tag VÀ business rule Host-of-meeting/Admin cho MỌI request ghi mapping — không có đường tắt nào bỏ qua cả hai lớp kiểm tra.
NFR-002: THE system SHALL không cho phép gán externalParticipantId thuộc meeting khác (ERR ở FR-010).
```

### 4.2 Reliability & Consistency

```text
NFR-003: THE system SHALL đảm bảo việc gán hàng loạt là all-or-nothing trong một request — nếu bất kỳ mapping nào trong request không hợp lệ, KHÔNG mapping nào được ghi.
NFR-004: THE system SHALL đảm bảo GA-27 (áp lại khi rerun) chạy trong CÙNG transaction/bước với việc ghi transcript draft mới — nếu bước áp lại lỗi, KHÔNG được để transcript ở trạng thái draft mà thiếu áp mapping một cách âm thầm; lỗi phải được log rõ, job vẫn coi là hoàn tất (áp mapping là best-effort bổ sung, không phải điều kiện chặn transcript có sẵn để đọc).
```

### 4.3 Data Model Note — vì sao round-trip đúng dù `started_at` không phải t=0 thật

```text
NFR-005 (ghi chú kiến trúc, không phải requirement kiểm thử được): Công thức ghi là
event_time = recording_sessions.started_at + representativeOffsetMs. Công thức đọc
(GA-27) là offsetMs = event_time - recording_sessions.started_at (CÙNG session, CÙNG
cột, không đổi giữa lúc ghi và lúc đọc). Vì started_at là HẰNG SỐ ổn định cho một
recording session (được set một lần khi tạo session, không sửa lại), phép trừ luôn
cho ra ĐÚNG offsetMs gốc bất kể started_at có phải t=0 thật của audio hay không. Do
đó feature này (chỉ gán SAU buổi họp) hoạt động đúng độc lập với GIAI ĐOẠN 3.
```

### 4.4 Maintainability

```text
NFR-006: THE system SHALL viết unit test cho: tính mốc đại diện (segment dài nhất), quy tắc gộp/mâu thuẫn (ERR-TAG-001/002/003), áp lại khi rerun tìm đúng segment theo offset, và trường hợp offset không rơi vào segment nào (ERR-TAG-007).
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `transcripts` | Đọc `speaker_segments_json`/`detected_speakers_json` để tính mốc đại diện; ghi lại sau khi áp mapping | Bảng đã có, không đổi schema |
| `meeting_events` | Ghi bản ghi `event_type='speaker_tag'` — nguồn sự thật độc lập | Bảng đã có, chỉ thêm giá trị enum TypeScript `MeetingEventType.SPEAKER_TAG`, KHÔNG cần DDL (`event_type` là `varchar(60)`) |
| `recording_sessions` | Đọc `started_at` để quy đổi audio-offset ↔ wall-clock | Bảng đã có, KHÔNG sửa |
| `meeting_external_participants` | Validate `externalParticipantId` thuộc đúng meeting | Bảng đã có, KHÔNG sửa |
| `users` | Validate `speakerUserId` tồn tại | Bảng đã có, KHÔNG sửa |
| `permissions`/`role_permissions` | Seed `transcript.speaker_tag` | Migration mới, KHÔNG sửa schema |

**KHÔNG có bảng mới, KHÔNG có cột mới** — đúng nguyên tắc ADD-ONLY của CLAUDE.md mục 5.4 và Definition of Done mục 12 của plan tổng ("Không thêm bảng mới, không lệch database baseline").

### 5.2 Dữ liệu đầu vào — `POST /transcripts/:transcriptId/speaker-mappings`

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| `mappings` | array | Có | Danh sách mapping | `ArrayMinSize(1)` |
| `mappings[].speakerLabel` | string | Có | Nhãn cụm hiện có trong transcript (vd `Speaker_1`) | Phải khớp một `speakerLabel` thật trong `speaker_segments_json.segments` (ERR-TAG-004) |
| `mappings[].speakerUserId` | uuid | Điều kiện | User hệ thống | Đúng một trong `speakerUserId`/`externalParticipantId` (ERR-TAG-005), user phải tồn tại |
| `mappings[].externalParticipantId` | uuid | Điều kiện | Khách ngoài công ty | Phải thuộc đúng meeting của transcript (FR-010) |
| `mappings[].displayName` | string | Có | Tên hiển thị | `MaxLength(255)` |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| `appliedMappings` | array | Danh sách cụm đã gán thành công, kèm số segment bị ảnh hưởng |
| `mergedClusters` | array | Danh sách cụm đã bị GỘP do cùng identity (ERR-TAG-001), để FE thông báo cho Host biết |

### 5.4 State / Status Model — `detectedSpeakersJson.speakers[].mappingSource`

| Giá trị | Ý nghĩa | Nguồn |
|---|---|---|
| `unmapped` | Chưa gán tên | Trạng thái mặc định (feature trước) |
| `manual` | Đã gán tên qua feature này | GA-22/GA-27 |
| `conflict` | Mâu thuẫn khi áp lại — không gán | GA-27, ERR-TAG-003 (giá trị MỚI, cần thêm vào `VALID_MAPPING_SOURCE` phía Python schema NẾU pipeline Python cần biết trạng thái này — thực ra `conflict` chỉ phát sinh ở tầng BE khi áp lại, KHÔNG phát sinh trong Python worker, nên KHÔNG cần sửa `schemas.py`. Xem `Cần làm rõ` CLR-005 dưới) |

### 5.8 Cần làm rõ

- **CLR-005**: Giá trị `mappingSource='conflict'` chỉ tồn tại ở tầng backend NestJS (khi GA-27 áp lại), KHÔNG đi qua `schemas.py` validate của Python worker (Python chỉ tạo `unmapped`/`channel_zone`). Vì vậy `VALID_MAPPING_SOURCE` trong `schemas.py` (feature trước, `{"diarization", "channel_zone", "manual", "unmapped"}`) **không cần sửa** — giá trị `conflict` chỉ được backend NestJS ghi trực tiếp vào `detected_speakers_json` sau khi Python worker đã trả kết quả, không qua `validate_result()` nữa. Cần xác nhận với team rằng validate ở tầng Python KHÔNG áp dụng cho bước ghi bổ sung này (hợp lý vì đây là bước SAU pipeline, thuộc trách nhiệm backend).

---

## 6. Error Handling

```text
ERR-001: IF transcriptId không tồn tại, THEN THE system SHALL trả 404.
ERR-002: IF transcript.recording_session_id là null, THEN THE system SHALL trả 409 (không tính được mốc đại diện quy về audio).
ERR-003: IF transcript đang ở trạng thái processing, THEN THE system SHALL trả 409 (FR-008).
```

(Các case authz/business rule đã liệt kê ở mục 3.5 ERR-TAG-*.)

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given transcript draft có 2 cụm Speaker_1 (13 segment) và Speaker_2 (10 segment), Host là host hợp lệ của meeting,
When Host gọi POST speaker-mappings với [{speakerLabel: "Speaker_1", speakerUserId: "<uuid anh Nam>", displayName: "Nam"}, {speakerLabel: "Speaker_2", externalParticipantId: "<uuid khách>", displayName: "Chị Lan (khách)"}],
Then toàn bộ 13 segment Speaker_1 có speakerUserId=<uuid anh Nam>, toàn bộ 10 segment Speaker_2 có metadata khách "Chị Lan (khách)", và 2 bản ghi meeting_events event_type=speaker_tag được tạo.
```

### 7.2 Safety Cases — quyết định #9

```text
AC-002 (gộp — an toàn):
Given Host gán Speaker_3 và Speaker_7 đều là speakerUserId=<uuid anh Bình> trong cùng 1 request,
When request được xử lý,
Then cả segment của Speaker_3 lẫn Speaker_7 đều nhận mappedUserId=<uuid anh Bình>, response liệt kê 2 cụm này trong mergedClusters.

AC-003 (mâu thuẫn — không đoán, trong 1 request):
Given Host gán Speaker_3 = anh A và cũng Speaker_3 = ông Hùng trong CÙNG 1 request,
When request được xử lý,
Then toàn bộ request bị từ chối 400, KHÔNG mapping nào được ghi (ERR-TAG-002).

AC-004 (mâu thuẫn khi rerun — GA-27):
Given meeting_events có 2 mapping cũ (mốc A -> anh A, mốc B -> ông Hùng), sau khi chạy lại transcription cả 2 mốc đều rơi vào CÙNG speakerLabel mới (Speaker_5 của lần chạy mới),
When bước áp lại mapping chạy sau khi transcript mới ghi xong,
Then Speaker_5 giữ nguyên unknown/không gán tên, mappingSource='conflict', manualReviewRequired=true, KHÔNG chọn đại theo thứ tự nào.
```

### 7.3 Persistence Case — mục tiêu cốt lõi của cả GIAI ĐOẠN 2

```text
AC-005:
Given transcript v1 đã được Host gán tên đầy đủ cho 3 cụm,
When Host chạy lại transcription cho cùng recording session (tạo transcript v2, ranh giới segment có thể đổi chút do đổi tham số),
Then transcript v2 tự động có tên đã gán ở các segment rơi đúng vào mốc đại diện cũ, KHÔNG cần Host thao tác lại — đây là bằng chứng thiết kế `meeting_events` (mục 4.1 plan tổng) hoạt động đúng.
```

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID | Kịch bản |
|---|---|---|
| AC-001 | FR-001, FR-005, FR-006 | Happy path gán hàng loạt |
| AC-002 | ERR-TAG-001 | Gộp cùng người nhiều cụm |
| AC-003 | ERR-TAG-002 | Mâu thuẫn trong 1 request |
| AC-004 | ERR-TAG-003 | Mâu thuẫn khi áp lại (rerun) |
| AC-005 | FR-004, FR-007 | Sống sót qua rerun — mục tiêu cốt lõi |

---

## 8. Out of Scope

- Gán trực tiếp TRONG LÚC họp (`tagSource='live'`), mốc t=0, endpoint "Bắt đầu ghi âm" — thuộc GIAI ĐOẠN 3, feature riêng `feat-speaker-tagging-live`.
- Bất kỳ màn hình FE nào — theo yêu cầu của Thiếu Chủ, phiên này CHỈ làm BE.
- Sửa `transcript-segments.controller.ts` (`PATCH .../segments`, UC-127) — endpoint đó giữ nguyên, feature này chỉ THÊM endpoint mới.
- Thay đổi `SPEAKER_ASSIGN_MIN_OVERLAP_RATIO`/`SPEAKER_ASSIGN_MIN_CONFIDENCE` hay bất kỳ logic Python pipeline nào — feature này thuần backend NestJS, không đụng `workers/ai-transcription/python/`.
- Làm cho `recording_sessions.started_at` phản ánh t=0 thật — thuộc GIAI ĐOẠN 3.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement live/in-meeting speaker tagging as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or columns as part of this feature.
OOS-003: THE system SHALL NOT modify the Python AI worker pipeline as part of this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS.
- [x] Đủ 5 EARS basic patterns.
- [x] Mỗi requirement có mã ID.
- [x] Error handling bao gồm validation/authz/business rule/conflict.
- [x] Acceptance Criteria Given/When/Then.
- [x] Traceability đầy đủ.
- [x] Out of Scope rõ ràng.
- [x] Cần làm rõ đã liệt kê (CLR-001..005) kèm diễn giải/quyết định tạm.
