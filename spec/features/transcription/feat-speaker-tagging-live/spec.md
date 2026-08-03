## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-02 | Tạo spec.md ban đầu — GIAI ĐOẠN 3 của `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (GA-30→GA-36). Viết sau khi GIAI ĐOẠN 2 (`feat-speaker-tagging-post-meeting`) đã implement + verify thật trên DB chung — feature này tái sử dụng gần như toàn bộ hạ tầng đã có (`SpeakerMappingService`, `meeting_events`, logic gộp/mâu thuẫn), chỉ thêm cách TẠO mốc thời gian mới. | Toàn bộ file (mới) |

> File này là tài liệu documentation-first, **chưa code**. Nguồn quyết định gốc: `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` mục 3 (quyết định #2, #7, #9), mục 4, GIAI ĐOẠN 3, mục 8, mục 9 (rủi ro R6). Đối chiếu code thật: `feat-speaker-tagging-post-meeting` (đã implement), `src/modules/recording/services/recording-session.service.ts` (`uploadAudioForTranscription`), `src/modules/meetings/entities/meeting.entity.ts`.

---

# Feature Specification: Speaker Tagging — Live (gán danh tính trực tiếp trong lúc họp)

- **Feature ID**: TRANS-SPEAKER-TAG-LIVE-001
- **Feature Name**: Host bấm "Bắt đầu ghi âm" để đóng dấu mốc t=0, và gán tên người đang nói ngay trong lúc họp — mốc được quy chiếu và áp vào transcript sau khi audio được upload và xử lý
- **Module / Domain**: `transcription` (toàn bộ nằm trong module này — xem mục 4.4 "Không đụng module `recording`")
- **Created Date**: 2026-08-02
- **Status**: Draft
- **Source Documents**:
  - `Docs/Get_Audio/PLAN_TONG_THE_GAN_DANH_TINH_NGUOI_NOI.md` (mục 3 quyết định #2/#7/#9, mục 4, GIAI ĐOẠN 3, mục 8.1, mục 9 rủi ro R6)
  - `spec/features/transcription/feat-speaker-tagging-post-meeting/spec.md` + `plan.md` (feature nền — đã implement, đã verify thật trên DB chung 2026-08-02)
  - `src/modules/transcription/speaker-mapping.service.ts` (code thật đã có)
  - `src/modules/recording/services/recording-session.service.ts` (`uploadAudioForTranscription` — xác nhận `recording_sessions` được tạo LÚC UPLOAD, không phải lúc họp)
  - `src/modules/meetings/entities/meeting.entity.ts` (`startTime`, `endTime`, `actualStartTime`, `actualEndTime`)

---

## 1. Context & Goal

### 1.1 Bối cảnh

GIAI ĐOẠN 2 đã cho Host gán tên **sau khi** transcript đã có, dựa trên nghe/đọc lại từng cụm giọng. GIAI ĐOẠN 3 bổ sung cách gán **trong lúc họp đang diễn ra** — Host bấm "lúc này là anh A đang nói" ngay khi nghe thấy, không cần nhớ lại sau. Cả hai cách cùng ghi vào `meeting_events` (`event_type='speaker_tag'`) và cùng đi qua một bước "áp mapping" chung — khác nhau duy nhất ở **cách xác định mốc thời gian gốc (t=0)** để quy đổi từ "giờ thật Host bấm" sang "giây thứ mấy trong file audio".

**Phát hiện kiến trúc quan trọng khi đối chiếu code thật (không có trong plan gốc):** `recording_sessions` — bảng đang giữ cột `started_at` mà GIAI ĐOẠN 2 dùng làm mốc neo — **chỉ được tạo tại thời điểm Host upload file audio** (`RecordingSessionService.uploadAudioForTranscription()`, `startedAt = new Date()` **lúc gọi API upload**, xem plan.md mục 3.1). Nghĩa là khi Host bấm "Bắt đầu ghi âm" TRONG cuộc họp (GA-30), **row `recording_sessions` chưa hề tồn tại** — có thể vài giờ hoặc vài ngày sau mới có, lúc Host rảnh để upload file. Do đó mốc t=0 và các mốc gán trực tiếp **không thể** neo vào `recording_sessions.started_at` như GIAI ĐOẠN 2 đã làm — phải neo vào một sự kiện `meeting_events` riêng, độc lập với việc audio đã upload hay chưa.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host, trong lúc cuộc họp đang diễn ra, bấm một nút để đánh dấu mốc "bắt đầu ghi âm" (đồng bộ với lúc bấm ghi trên thiết bị mic vật lý), và bấm gán "người này đang nói" bất cứ lúc nào trong họp — để sau khi audio được upload và transcript được tạo, hệ thống **tự động quy chiếu** các mốc đó thành tên người nói gắn vào đúng cụm giọng, dùng lại chính xác cơ chế gộp/mâu thuẫn/áp-lại-khi-rerun đã có từ GIAI ĐOẠN 2 mà không cần viết lại.

### 1.3 Giá trị mang lại

- Cho Host: gán ngay lúc nhớ rõ ai đang nói, không phải đoán lại khi nghe transcript sau này — giảm sai sót gán nhầm.
- Cho hệ thống: tận dụng lại 100% hạ tầng gộp/mâu thuẫn/áp-lại đã build và verify thật ở GIAI ĐOẠN 2 — feature này chỉ thêm "nguồn tạo mốc mới", không viết lại logic áp dụng.
- Cho rủi ro vận hành: có phương án dự phòng (GA-35) khi Host quên bấm nút — không làm mất khả năng gán chỉ vì một thao tác bị bỏ lỡ.

### 1.4 Giả định

- GIAI ĐOẠN 2 đã implement và verify thật (`SpeakerMappingService`, permission `transcript.speaker_tag`, `MeetingEventType.SPEAKER_TAG`) — feature này **tái sử dụng nguyên vẹn**, không sửa lại logic gộp/mâu thuẫn đã có (`applyResolvedMappingsToTranscript`), chỉ mở rộng nguồn dữ liệu đầu vào của `applySpeakerMappingsFromEvents()`.
- Không cần permission mới — dùng lại `transcript.speaker_tag` (đã seed, đã gán đúng 4 role thật) cho cả 3 endpoint mới của feature này, vì về bản chất đều là cùng một hành động nghiệp vụ "gán danh tính người nói", chỉ khác thời điểm.
- Đồng hồ client (điện thoại/máy tính của Host) **không được tin cậy** — mọi mốc thời gian đều do server đóng dấu (`event_time` default `now()`), đúng quyết định #7 đã chốt. Ngoại lệ DUY NHẤT: GA-35 (nhập tay khi quên bấm) — Host phải nhập một thời điểm ĐÃ QUA, server không thể tự đóng dấu thay được; xem mục 3.5 validate.
- `meeting_events.event_time` là `timestamptz NOT NULL`, không có cột nào khác trong `meeting_events` phù hợp hơn để lưu mốc t=0 tạm thời trước khi có `recording_sessions` — dùng chính cơ chế đã có (bảng có sẵn), không thêm bảng/cột.

### 1.5 Cần làm rõ

- **CLR-001 (double-tap "Bắt đầu ghi âm")**: Plan gốc không nói rõ Host bấm nút 2 lần thì xử lý sao (bấm nhầm, bấm lại). Spec này chốt: **cho phép bấm nhiều lần, không báo lỗi** — mỗi lần tạo một bản ghi `meeting_events` mới (`event_type='recording_start_marker'`). Khi quy chiếu (mục 4), luôn dùng bản ghi **MỚI NHẤT** (giả định lần bấm sau là lần đúng ý, ví dụ bấm nhầm sớm rồi bấm lại đúng lúc). Đây là diễn giải an toàn nhất do không có cách nào server biết lần bấm nào "đúng" hơn — chọn "mới nhất" nhất quán, dễ hiểu cho Host debug nếu sai.
- **CLR-002 (nhiều recording session cho 1 meeting)**: Feature này giả định **1 meeting = 1 recording session** cho luồng 1-mic-phòng (đúng quyết định #1 plan tổng). Vì marker/live-tag được lưu theo `meetingId` (không có `recordingSessionId` vì chưa tồn tại), nếu một meeting có NHIỀU recording session (trường hợp hiếm — ví dụ Host tạo lại session sau lỗi upload), mốc live sẽ áp vào TẤT CẢ session của meeting đó khi mỗi session tự chạy `applySpeakerMappingsFromEvents`. Chấp nhận được cho MVP vì hiếm gặp; ghi rõ để không ai ngạc nhiên.
- **CLR-003 (chưa có marker khi live-tag)**: Nếu Host bấm gán "anh A đang nói" TRƯỚC KHI bấm "Bắt đầu ghi âm" (quên thứ tự), sự kiện gán vẫn được lưu bình thường (không chặn) — nhưng KHÔNG áp được vào transcript nào cho tới khi có marker (mục 3.5 ERR-LIVE-003). Đây là hệ quả tự nhiên của thiết kế, không phải bug.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Host/Organizer | Actor chính, thao tác TRONG lúc họp | Bấm "Bắt đầu ghi âm" (GA-30), bấm gán người đang nói (GA-32), nhập tay t=0 nếu quên (GA-35) |
| Business Admin / System Admin | Dự phòng (quyết định #3) | Giống Host, không giới hạn theo meeting |
| Hệ thống (SpeakerMappingService, khi transcript được ghi) | Actor nội bộ | Quy chiếu mốc live → offset audio → cụm giọng, dùng LẠI `applySpeakerMappingsFromEvents()` đã có |

### 2.2 Role & Permission Rules

- Dùng lại `transcript.speaker_tag` (đã seed GIAI ĐOẠN 2, 4 role EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN) cho cả 3 endpoint mới — **không seed permission mới**.
- Business rule Host-of-meeting-or-Admin **copy nguyên logic đã có** trong `SpeakerMappingService` (không viết lại).

### 2.3 Actor Constraints

- User phải đăng nhập, có permission `transcript.speaker_tag`, VÀ (là Host của đúng meeting HOẶC Admin).
- Endpoint GA-30/32/35 chỉ cần `meetingId` hợp lệ — **không cần** transcript hay recording session đã tồn tại (đây chính là điểm khác biệt cốt lõi so với GIAI ĐOẠN 2).

---

## 3. Functional Requirements

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cung cấp endpoint để Host đánh dấu mốc "bắt đầu ghi âm" cho một meeting, lưu dưới dạng `meeting_events` với `event_type='recording_start_marker'` (giá trị enum MỚI, thêm vào `MeetingEventType` — không DDL vì cột là varchar).
FR-002: THE system SHALL cung cấp endpoint để Host gán "người này đang nói ngay bây giờ" trong lúc họp, lưu dưới dạng `meeting_events` với `event_type='speaker_tag'`, `metadata_json.tagSource='live'`, `metadata_json.recordingSessionId=null` (CHƯA XÁC ĐỊNH được tại thời điểm này — khác GIAI ĐOẠN 2 luôn có recordingSessionId ngay).
FR-003: THE system SHALL, khi áp mapping vào transcript (`applySpeakerMappingsFromEvents`, đã có từ GIAI ĐOẠN 2), MỞ RỘNG để xử lý cả sự kiện `tagSource='live'` bên cạnh `tagSource='post'` đã có — dùng ANCHOR KHÁC NHAU theo tagSource (mục 4).
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN Host bấm "Bắt đầu ghi âm", THE system SHALL ghi một bản ghi `meeting_events` mới với `event_time` do SERVER đóng dấu (`now()`, không tin đồng hồ client — đúng quyết định #7), `actor_user_id` là Host, `source_type='manual'`.
FR-005: WHEN Host bấm gán người đang nói, THE system SHALL ghi `meeting_events` với `event_time=now()` (server) và `metadata_json={ speakerUserId?, externalParticipantId?, displayName, tagSource:'live', recordingSessionId:null }` — KHÔNG yêu cầu `speakerLabel` (khác GA-20 của GIAI ĐOẠN 2 — tại thời điểm này chưa có cụm giọng nào tồn tại để chọn).
FR-006: WHEN transcript mới được ghi cho một recording session (`updateTranscriptResult`, đã có từ GIAI ĐOẠN 2), THE system SHALL, trong bước `applySpeakerMappingsFromEvents`, TÌM mốc "bắt đầu ghi âm" mới nhất của meeting đó (`recording_start_marker`) để làm anchor cho các sự kiện `tagSource='live'`, thay vì dùng `recording_sessions.started_at` (anchor đó chỉ đúng cho `tagSource='post'`).
```

### 3.3 State-driven Requirements

```text
FR-007: WHILE một meeting CHƯA có bất kỳ bản ghi `recording_start_marker` nào (Host quên bấm cả lúc họp lẫn không dùng GA-35), THE system SHALL KHÔNG áp bất kỳ sự kiện `tagSource='live'` nào của meeting đó vào transcript — giữ nguyên `unknown`/`unmapped`, không suy đoán anchor thay thế (không được âm thầm dùng `recording_sessions.started_at` làm anchor giả cho sự kiện live, vì sai lệch có thể tới hàng giờ/ngày).
```

### 3.4 Optional Feature Requirements

```text
FR-008: WHERE Host quên bấm "Bắt đầu ghi âm" trong lúc họp, THE system SHALL cho phép nhập tay một thời điểm quá khứ qua endpoint riêng (GA-35) — kết quả tạo CÙNG LOẠI bản ghi `recording_start_marker` như bấm trực tiếp, để bước quy chiếu (FR-006) xử lý đồng nhất, không cần nhánh logic riêng.
```

### 3.5 Unwanted Behavior Requirements

```text
ERR-LIVE-001: IF actor không phải Host của meeting và không có role BUSINESS_ADMIN/SYSTEM_ADMIN, THEN THE system SHALL từ chối cả 3 endpoint (GA-30/32/35) với 403.
ERR-LIVE-002 (GA-35 — validate mốc nhập tay): IF thời điểm Host nhập tay ở trong TƯƠNG LAI (so với giờ server), THEN THE system SHALL từ chối với lỗi validation rõ ràng.
ERR-LIVE-003 (GA-35 — validate mốc nhập tay): IF thời điểm Host nhập tay CÁCH XA bất thường so với thời gian cuộc họp (ưu tiên so với `meetings.actual_start_time` nếu có, fallback `meetings.start_time`; ngưỡng đề xuất ±24 giờ — xem plan.md để chốt số cụ thể), THEN THE system SHALL từ chối với lỗi validation, tránh Host nhập nhầm ngày/giờ hoàn toàn sai gây quy chiếu vô nghĩa.
ERR-LIVE-004: IF không có bản ghi `recording_start_marker` nào cho meeting tại thời điểm áp mapping, THEN THE system SHALL bỏ qua toàn bộ sự kiện `tagSource='live'` của meeting đó (không crash, không suy đoán) — đúng FR-007.
ERR-LIVE-005: IF sự kiện `tagSource='live'` sau khi quy đổi offset KHÔNG rơi vào bất kỳ segment nào của transcript hiện tại, THEN THE system SHALL bỏ qua sự kiện đó — TÁI SỬ DỤNG NGUYÊN VẸN quy tắc ERR-TAG-007 đã có từ GIAI ĐOẠN 2, không viết logic mới.
```

### 3.6 Requirement Notes

- FR-003/FR-006 là trung tâm của feature này: **không viết lại** `applyResolvedMappingsToTranscript`/logic gộp-mâu thuẫn (ERR-TAG-001/002/003 của GIAI ĐOẠN 2 áp dụng nguyên vẹn cho cả sự kiện live lẫn post trong CÙNG một lượt group-by-speakerLabel-mới — Host gán "anh A" live ở một cụm và gán "anh A" post ở cụm khác vẫn GỘP đúng theo quyết định #9, vì cơ chế conflict-detection không phân biệt nguồn sự kiện).
- ERR-LIVE-005 minh hoạ nguyên tắc tái sử dụng: đây là cùng một rule đã implement và test ở GIAI ĐOẠN 2 (T-TAG-008), feature này KHÔNG viết test riêng cho case này, chỉ cần test rằng sự kiện live cũng ĐI QUA được cùng pipeline.

### 3.7 Traceability

| Requirement ID | EARS Pattern | Nguồn | Ghi chú |
|---|---|---|---|
| FR-001, FR-004 | Ubiquitous/Event-driven | GA-30 | Endpoint marker |
| FR-002, FR-005 | Event-driven | GA-32 | Endpoint gán live, KHÔNG có speakerLabel |
| FR-003, FR-006 | Event-driven | GA-33 | Mở rộng `applySpeakerMappingsFromEvents` |
| FR-007, ERR-LIVE-004 | State/Unwanted | GA-31, R6 (rủi ro plan tổng) | Không có marker → không áp |
| FR-008 | Optional Feature | GA-35 | Dự phòng quên bấm |
| ERR-LIVE-005 | Unwanted (tái sử dụng) | GA-33, kế thừa ERR-TAG-007 | Không viết lại |

---

## 4. Kiến trúc quy chiếu (kỹ thuật cốt lõi — không lặp lại ở plan.md mà tóm tắt tại đây vì spec cần đủ để hiểu WHAT)

### 4.1 Hai loại anchor cho hai tagSource

| `tagSource` | Anchor (mốc t=0) | Áp dụng từ |
|---|---|---|
| `post` (GIAI ĐOẠN 2) | `recording_sessions.started_at` (thời điểm tạo session — tự tham chiếu, không cần là t=0 thật) | Đã implement |
| `live` (feature này) | Bản ghi `recording_start_marker` MỚI NHẤT của cùng `meetingId` (CLR-001) | Feature này |

### 4.2 Vì sao KHÔNG trộn hai anchor

Nếu dùng `recording_sessions.started_at` cho sự kiện `live`, offset tính ra sẽ sai lệch bằng đúng khoảng thời gian từ lúc họp kết thúc đến lúc Host upload file (có thể hàng giờ/ngày) — quy chiếu vô nghĩa. Đây là lý do FR-007/ERR-LIVE-004 bắt buộc: thà không áp còn hơn áp sai.

### 4.3 Không đụng module `recording`

Toàn bộ thiết kế nằm gọn trong module `transcription`: `SpeakerMappingService` đã có sẵn repository cho `MeetingEventEntity` và `RecordingSessionEntity` (từ GIAI ĐOẠN 2) — đủ để đọc marker VÀ đọc `recording_sessions.started_at` mà không cần thêm import module nào, không cần sửa `RecordingSessionService`/`uploadAudioForTranscription()`. Điều này tránh được rủi ro phụ thuộc vòng (`RecordingModule` hiện KHÔNG import `TranscriptionModule`; nếu để logic quy chiếu trong `recording` module thì sẽ phải tạo phụ thuộc ngược, vì `TranscriptionModule` đã import `RecordingModule` từ trước).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meeting_events` | Lưu cả marker (`recording_start_marker`) lẫn tag live (`speaker_tag`/`tagSource=live`) | Bảng đã có, thêm 1 giá trị enum TypeScript mới, KHÔNG DDL |
| `recording_sessions` | CHỈ đọc `started_at` (vẫn dùng cho `tagSource='post'`, không đổi) | KHÔNG sửa |
| `meetings` | Đọc `actual_start_time`/`start_time` để validate mốc nhập tay GA-35 (ERR-LIVE-003) | KHÔNG sửa |

**KHÔNG có bảng mới, KHÔNG có cột mới** — đúng nguyên tắc ADD-ONLY, tiếp nối GIAI ĐOẠN 2.

### 5.2 `metadata_json` của `recording_start_marker`

| Field | Mô tả |
|---|---|
| (không cần field đặc biệt — `event_time` của chính bản ghi này LÀ mốc t=0) | Có thể để `metadata_json = { source: 'live_tap' \| 'manual_entry' }` để phân biệt khi debug, không bắt buộc theo FR nào |

### 5.3 `metadata_json` của `speaker_tag` khi `tagSource='live'`

Giống hệt cấu trúc GIAI ĐOẠN 2 nhưng `recordingSessionId` LUÔN là `null` tại thời điểm ghi:

```json
{ "recordingSessionId": null, "speakerUserId": "...", "externalParticipantId": null, "displayName": "...", "tagSource": "live" }
```

### 5.8 Cần làm rõ

- Không phát sinh thêm ngoài mục 1.5.

---

## 6. Error Handling

```text
ERR-001: IF meetingId không tồn tại, THEN THE system SHALL trả 404 cho cả 3 endpoint mới.
```

(Các case authz/business rule đã liệt kê ở mục 3.5 ERR-LIVE-*.)

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given Host bấm "Bắt đầu ghi âm" lúc 09:00:00 (server time), sau đó bấm gán "anh A đang nói" lúc 09:02:00,
When audio được upload nhiều giờ sau và transcript được tạo,
Then hệ thống tính offset = 09:02:00 - 09:00:00 = 120000ms, tìm đúng segment chứa mốc 120s trong transcript, gán tên "anh A" cho cụm giọng tương ứng.
```

### 7.2 Safety Cases

```text
AC-002 (CLR-001 — double-tap):
Given Host bấm "Bắt đầu ghi âm" 2 lần (09:00:00 và 09:00:15, nhầm lẫn),
When hệ thống quy chiếu,
Then dùng mốc MỚI NHẤT (09:00:15) làm anchor, không dùng mốc đầu.

AC-003 (FR-007/ERR-LIVE-004 — không có marker):
Given Host bấm gán live nhưng KHÔNG bấm "Bắt đầu ghi âm" và KHÔNG dùng GA-35,
When hệ thống quy chiếu,
Then sự kiện live đó KHÔNG được áp vào transcript, không lỗi, không đoán.

AC-004 (GA-35 — nhập tay hợp lệ):
Given Host quên bấm marker, sau đó dùng endpoint nhập tay với thời điểm hợp lý (trong khoảng thời gian cuộc họp diễn ra),
When hệ thống quy chiếu,
Then mốc nhập tay được dùng làm anchor y hệt như bấm trực tiếp.

AC-005 (ERR-LIVE-002 — nhập tay tương lai):
Given Host nhập một thời điểm SAU thời điểm hiện tại,
When gọi endpoint nhập tay,
Then request bị từ chối, không tạo bản ghi.

AC-006 (Gộp giữa live và post — kế thừa quyết định #9):
Given Host gán "anh A" live cho một mốc rơi vào Speaker_3, sau đó gán "anh A" (post) cho Speaker_7,
When hệ thống áp mapping,
Then cả Speaker_3 và Speaker_7 đều mang tên "anh A" — GỘP đúng dù nguồn sự kiện khác nhau (live + post).
```

### 7.3 Acceptance Criteria Traceability

| AC ID | Requirement ID | Kịch bản |
|---|---|---|
| AC-001 | FR-004, FR-005, FR-006 | Happy path quy chiếu live |
| AC-002 | CLR-001 | Double-tap dùng mốc mới nhất |
| AC-003 | FR-007, ERR-LIVE-004 | Không có marker → không áp |
| AC-004 | FR-008 | Nhập tay thay thế đúng |
| AC-005 | ERR-LIVE-002 | Validate tương lai |
| AC-006 | FR-003 (tái sử dụng ERR-TAG-001) | Gộp xuyên nguồn live/post |

---

## 8. Out of Scope

- Màn hình FE (nút bấm ghi âm, thông báo nhắc, màn hình gán trực tiếp) — theo yêu cầu chỉ làm BE của Thiếu Chủ, thuộc GIAI ĐOẠN 4.
- Làm cho `recording_sessions.started_at` phản ánh t=0 thật — KHÔNG cần nữa, vì feature này neo qua `recording_start_marker` độc lập, không phụ thuộc cột đó.
- Thông báo nhắc Host nếu quá giờ mà chưa bấm — thuộc FE (GIAI ĐOẠN 4).
- Bất kỳ thay đổi nào ở module `recording` — xem mục 4.3.
- Giới hạn số lần bấm marker/live-tag (rate limiting) — không có yêu cầu, không tự thêm.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement any frontend UI as part of this feature.
OOS-002: THE system SHALL NOT modify src/modules/recording/** as part of this feature.
OOS-003: THE system SHALL NOT create new database tables or columns as part of this feature.
OOS-004: THE system SHALL NOT rewrite the conflict/merge logic already implemented in feat-speaker-tagging-post-meeting — only extend its input sources.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS.
- [x] Đủ 5 EARS pattern.
- [x] Mỗi requirement có mã ID.
- [x] Error handling bao gồm case liên quan.
- [x] Acceptance Criteria Given/When/Then.
- [x] Traceability đầy đủ.
- [x] Out of Scope rõ ràng — đặc biệt nhấn mạnh KHÔNG đụng module `recording`.
- [x] Cần làm rõ đã liệt kê (CLR-001..003).
