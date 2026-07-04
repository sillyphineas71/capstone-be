# Feature Specification: Xem chi tiết biên bản họp (View Meeting Minutes Detail)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-03, viết lại từ UC gốc sau gap analysis (đổi wording trạng thái, làm rõ quyền truy cập, tách phần export, bổ sung Exception còn thiếu) | Toàn bộ file |

> Nguồn gốc: UC-MKM-03 "Xem chi tiết biên bản họp" (Feature Table). Bản gốc dùng wording trạng thái "Draft/Official/Archived" không khớp enum thực tế (`draft/published/archived/deleted`), không định nghĩa rule quyền truy cập cụ thể, và gộp chức năng Export vào "Other Information". Spec này chuẩn hóa lại theo đúng baseline code hiện có (`MeetingMinutesEntity`, `feat-create-draft-meeting-minutes`, `feat-list-meeting-minutes`, `feat-attach-minutes-document`).

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi biên bản họp được tạo (`feat-create-draft-meeting-minutes`, UC-MKM-01) và người dùng tìm thấy nó qua danh sách (`feat-list-meeting-minutes`, UC-MKM-02), người dùng cần xem toàn bộ nội dung chi tiết: thông tin hành chính, nội dung chính, tài nguyên liên quan (transcript/recording), và file đính kèm.

### 1.2 Đánh giá sẵn sàng triển khai
**Feature này đã đủ điều kiện để lên spec/implement ngay**, vì mọi phụ thuộc dữ liệu đều đã tồn tại ở tầng đọc (read-only), không cần chờ tính năng ghi nào hoàn thiện trước:
- `meeting_minutes`, `meetings`, `rooms`, `meeting_participants`, `users` — đã có đầy đủ trong baseline, được `feat-create-draft-meeting-minutes`/`feat-list-meeting-minutes` sử dụng ổn định.
- `transcripts`, `media_files` (bao gồm cả các file đính kèm theo `feat-attach-minutes-document`) — đã có entity sẵn trong baseline. Phần "File đính kèm" trong response chỉ cần một câu SELECT trên `media_files` theo `relatedEntityType/relatedEntityId` — **không cần chờ** `feat-attach-minutes-document` implement xong; nếu chưa có ai upload, phần này trả về mảng rỗng một cách an toàn (xem mục 1.4).
- Duy nhất phần **Export PDF/Word** (nêu ở "Other Information" của UC gốc) phụ thuộc hạ tầng `background_jobs` chưa sẵn sàng cho minutes — feature này **loại Export ra khỏi phạm vi** (xem mục 8), không phải vì thiếu điều kiện mà vì đó là một luồng nghiệp vụ khác (export/report, không phải view).

### 1.3 Mục tiêu
Cung cấp 1 endpoint `GET` trả về toàn bộ dữ liệu chi tiết của một biên bản họp mà người dùng có quyền xem, kèm theo 2 cờ điều khiển UI (`canEdit`, `canIssue`) để FE quyết định hiển thị nút "Chỉnh sửa biên bản"/"Ban hành chính thức" theo đúng AF1 của UC gốc — dù bản thân 2 hành động đó là feature riêng, chưa tồn tại (xem mục 8).

### 1.4 Giả định
- Quyền truy cập chi tiết **tái sử dụng nguyên vẹn rule phân quyền đã có ở `feat-list-meeting-minutes`** (đã được review/chấp nhận trước đó), KHÔNG dùng `meeting_minutes.visibility_level` (field này tồn tại trong entity nhưng hiện không được bất kỳ luồng nào trong code đọc/ghi có ý nghĩa — coi là chưa kích hoạt, xem mục 1.5).
- "File đính kèm" trong response đọc trực tiếp `media_files` theo `relatedEntityType = 'meeting_minutes' AND relatedEntityId = :minutesId AND deletedAt IS NULL`, không phụ thuộc việc `feat-attach-minutes-document` đã code xong hay chưa — vì đây thuần là câu SELECT trên bảng đã tồn tại.
- "Tài nguyên liên quan" = tham chiếu rút gọn tới `transcripts` (qua `linkedTranscriptId`) và `media_files` bản ghi âm/hình (qua `linkedRecordingFileId`) — KHÔNG trả toàn văn transcript hay nội dung file trong response này (FE tự gọi API chi tiết transcript/media riêng nếu cần xem đầy đủ — ngoài phạm vi).
- Danh sách "người có mặt/vắng mặt" lấy từ `attendees_snapshot_json` (đã đóng băng tại thời điểm tạo biên bản theo FR-006 của UC-MKM-01), KHÔNG truy vấn lại `meeting_participants` real-time — vì đây vốn là snapshot tĩnh theo thiết kế đã chốt ở UC-MKM-01. Response cần join thêm `users` để lấy `fullName/email` cho từng `userId` trong snapshot (snapshot chỉ lưu `userId`, không lưu tên).
- Luôn hiển thị **version hiện tại duy nhất** của biên bản (không có UI chọn version cũ) — vì tại thời điểm viết spec, mỗi `meeting_id` chỉ có tối đa 1 bản ghi `meeting_minutes` active (do `MINUTES_ALREADY_EXISTS` ở UC-MKM-01 chặn tạo trùng), nên khái niệm "nhiều version" chưa phát sinh trong thực tế.
- Trigger "nhấp vào liên kết thông báo biên bản đã ban hành" của UC gốc **chưa được hỗ trợ** — không tìm thấy notification event nào (`minutes.published`/tương tự) trong code. Feature này chỉ hỗ trợ trigger "chọn từ danh sách" (UC-MKM-02).

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] `meeting_minutes.visibility_level` (PRIVATE/PARTICIPANTS/DEPARTMENT/PUBLIC_INTERNAL) tồn tại trong entity nhưng chưa có business rule nào dùng nó (kể cả UC-MKM-01/02 đã implement cũng không đọc field này khi tính quyền). Feature này giữ nguyên hiện trạng (không dùng field), nhưng cần Product Owner xác nhận: có nên kích hoạt field này ở phiên bản sau để phân quyền mịn hơn (ví dụ PUBLIC_INTERNAL cho toàn công ty xem) không.
- [NEEDS CLARIFICATION] Số lượng file tối đa hiển thị trong "File đính kèm" — feature này không phân trang riêng (dựa vào giới hạn `MINUTES_ATTACHMENT_MAX_COUNT = 10` đã đề xuất ở `feat-attach-minutes-document`), cần xác nhận nếu giới hạn đó thay đổi.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee (Host/Participant của cuộc họp), Business Admin.
- Secondary Actor: System Admin (được xử lý tương đương Business Admin trong rule phân quyền, nhất quán với `feat-list-meeting-minutes`).

### 2.2 Role & Permission Rules
- Tái sử dụng permission đã seed: `meeting.minutes.read` (module_code=`minutes`, đã cấp cho `INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` qua migration `20260702010000-SeedMeetingMinutesReadPermission.ts`). **Không seed permission mới** — xem quyết định ở mục 6.1 của plan.md.
- Sở hữu permission là điều kiện cần nhưng chưa đủ: service còn áp dụng **scope rule** theo trạng thái biên bản + vai trò người gọi (mục 3.3).

### 2.3 Actor Constraints
- Participant chỉ xem được biên bản khi `status IN (published, archived)` — KHÔNG xem được bản `draft` (nhất quán BR1 của UC-MKM-01: bản nháp chỉ `preparedBy` và admin thấy).
- Người không liên quan đến cuộc họp (không phải host/participant/preparedBy) và không phải admin → không xem được, kể cả khi đã ban hành.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL trả về đầy đủ 4 nhóm dữ liệu cho 1 request hợp lệ: (1) Thông tin chung, (2) Nội dung chính, (3) Tài nguyên liên quan, (4) File đính kèm.
- **FR-002**: THE system SHALL KHÔNG thay đổi bất kỳ dữ liệu nào của biên bản, meeting, hay media file khi phục vụ request xem chi tiết (đúng POST-2 của UC gốc — read-only).
- **FR-003**: THE system SHALL trả về đúng 1 bản ghi `meeting_minutes` duy nhất theo `id` (không có khái niệm chọn version).

### 3.2 Event-driven Requirements
- **FR-004**: WHEN người dùng gửi `GET /api/v1/meeting-minutes/:id`, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi có quyền xem theo scope rule (mục 3.3), trước khi trả dữ liệu.
- **FR-005**: WHEN trả response, THE system SHALL join bổ sung: `meetings` (snapshot), `rooms` (nếu có `roomId`), `users` cho từng `userId` trong `attendeesSnapshotJson`, `users` cho `preparedBy/issuedBy/approvedBy` (nếu có), `transcripts` (nếu có `linkedTranscriptId`), `media_files` (nếu có `linkedRecordingFileId`, và toàn bộ file đính kèm theo `relatedEntityId`).

### 3.3 State-driven Requirements (Scope rule — BR-ACCESS)
- **FR-006**: WHILE người gọi có role `SYSTEM_ADMIN` hoặc `BUSINESS_ADMIN`, THE system SHALL cho xem biên bản ở bất kỳ trạng thái nào (`draft/published/archived`).
- **FR-007**: WHILE `meeting_minutes.status = draft` AND người gọi KHÔNG phải admin, THE system SHALL chỉ cho xem NẾU `preparedBy = userId` gọi request; ngược lại từ chối.
- **FR-008**: WHILE `meeting_minutes.status IN (published, archived)` AND người gọi KHÔNG phải admin, THE system SHALL cho xem NẾU `userId` là host của meeting (`meeting.hostId`) HOẶC tồn tại bản ghi `meeting_participants` với `userId` đó cho `meeting.id` này.
- **FR-009**: WHILE `meeting_minutes.status = deleted` (đã xóa mềm), THE system SHALL trả 404 cho MỌI actor, kể cả admin (không phân biệt "không có quyền" và "không tồn tại" khi đã xóa, tránh rò rỉ thông tin).

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE `meeting_minutes.linkedTranscriptId` khác NULL, THE system SHALL trả về `relatedResources.transcript` gồm `id, status, versionNo, languageCode` (không trả `rawText`/nội dung transcript đầy đủ).
- **FR-011**: WHERE `meeting_minutes.linkedRecordingFileId` khác NULL, THE system SHALL trả về `relatedResources.recording` gồm `id, fileName, durationSeconds, mimeType` (không trả `storageKey`/URL trực tiếp — FE gọi API media riêng để lấy link phát/tải).
- **FR-012**: WHERE tồn tại `media_files` với `relatedEntityType = 'meeting_minutes' AND relatedEntityId = :id AND deletedAt IS NULL`, THE system SHALL trả về mảng `attachments` (có thể rỗng), sắp xếp theo `uploadedAt DESC`.

### 3.5 Unwanted Behavior Requirements
- **FR-013**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả 404 `MEETING_MINUTES_NOT_FOUND`.
- **FR-014**: IF người gọi không thỏa scope rule ở mục 3.3, THEN THE system SHALL trả 403 `MEETING_MINUTES_ACCESS_DENIED`, KHÔNG tiết lộ nội dung biên bản trong response lỗi.
- **FR-015**: IF `id` không phải UUID hợp lệ, THEN THE system SHALL trả 400 (`ParseUUIDPipe`).

### 3.6 Workflow Requirements
- **FR-016**: THE system SHALL thực hiện toàn bộ việc đọc dữ liệu (minutes + các join phụ trợ) trong các câu SELECT độc lập, KHÔNG dùng transaction ghi (đây là read-only use case, không cần `dataSource.transaction`).

### 3.7 Data & State Requirements
- **FR-017**: THE system SHALL trả `permissions: { canEdit: boolean, canIssue: boolean }` trong response, với `canEdit = canIssue = (status === draft) AND (isAdmin OR preparedBy === userId gọi request)` — dùng để FE hiển thị nút theo AF1 của UC gốc. Bản thân hành động edit/issue là feature khác (mục 8), field này chỉ là cờ điều khiển UI.
- **FR-018**: THE system SHALL KHÔNG thêm cột mới vào bất kỳ bảng nào (chỉ đọc dữ liệu đã có).

### 3.8 Notification / Audit Requirements
- **FR-019**: THE system SHALL NOT ghi `audit_logs` cho hành động xem chi tiết (xem là thao tác đọc tần suất cao, không phải hành động nhạy cảm cần audit — nhất quán với việc UC-MKM-02 (list) cũng không ghi audit).
- **FR-020**: THE system SHALL NOT gửi notification khi có người xem biên bản.

### 3.9 Complex / Combined Requirements
- **FR-021**: IF biên bản tồn tại AND người gọi thỏa scope rule AND có file đính kèm AND có transcript/recording liên kết, THEN THE system SHALL trả về response gộp đầy đủ cả 4 nhóm dữ liệu trong 1 lần gọi (không yêu cầu FE gọi nhiều API để dựng màn hình chi tiết cơ bản — ngoại trừ nội dung đầy đủ transcript/tải file, xem FR-010/FR-011).

### 3.10 Traceability
| FR ID | Nguồn gốc (UC gốc) |
| :--- | :--- |
| FR-001, FR-021 | Normal Flow bước 4 |
| FR-002 | POST-2 |
| FR-004, FR-013, FR-014, FR-015 | PRE-1, PRE-2, PRE-3 (làm rõ, vì UC gốc để Exceptions = N/A) |
| FR-006, FR-007, FR-008, FR-009 | Normal Flow bước 2 (làm rõ quyền truy cập, thay cho PRE-3 mơ hồ) |
| FR-010, FR-011, FR-012 | Normal Flow bước 4 (Tài nguyên liên quan, File đính kèm) |
| FR-017 | AF1 |

## 4. Non-functional Requirements

### 4.1 Performance
- API phản hồi < 500ms trong điều kiện bình thường (1 lần đọc minutes + vài join nhỏ theo id, không phải full-table scan).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) + permission `meeting.minutes.read`.
- Scope rule (mục 3.3) enforce ở tầng service, không tin tưởng bất kỳ tham số phân quyền nào từ client.
- Không trả `storageKey`/đường dẫn vật lý file trong response (chỉ trả `id`/metadata, giữ nguyên nguyên tắc đã áp dụng ở `MediaFilesService.toSummary`).

### 4.3 Reliability & Consistency
- Idempotent tự nhiên (GET thuần túy, gọi lại nhiều lần không đổi trạng thái hệ thống).

### 4.4 Usability
- Response đủ dữ liệu để FE dựng toàn bộ màn hình chi tiết cơ bản trong 1 lần gọi (trừ nội dung đầy đủ transcript và link tải file, vốn cần API riêng vì lý do kích thước/bảo mật).

### 4.5 Observability
- Log ở mức debug: `minutesId`, `userId`, kết quả (allow/deny + lý do) — KHÔNG ghi audit_logs chính thức (xem FR-019).

### 4.6 Maintainability
- Đặt logic scope rule (`canAccessMinutes`) thành 1 method riêng trong `MinutesService`, dùng chung được cho cả feature này lẫn có thể tái cấu trúc `findMinutesList` sau này (không bắt buộc trong phạm vi feature này).

## 5. Data Model

### 5.1 Entity liên quan (chỉ đọc, không ghi)
`MeetingMinutesEntity`, `MeetingEntity`, `MeetingParticipantEntity` (gián tiếp, đã đóng băng trong snapshot — không query trực tiếp bảng này), `RoomEntity`, `UserEntity`, `TranscriptEntity`, `MediaFileEntity`.

### 5.2 Dữ liệu đầu vào
Path param: `id` (UUID, bắt buộc) — id của `meeting_minutes`.

### 5.3 Dữ liệu đầu ra (Response)
```jsonc
{
  "success": true,
  "message": "Chi tiet bien ban hop",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "string",
    "status": "draft | published | archived",
    "versionNo": 1,
    "generalInfo": {
      "meetingTitle": "string",
      "actualStartTime": "ISO datetime | null",
      "actualEndTime": "ISO datetime | null",
      "meetingMode": "offline | online | hybrid",
      "room": { "id": "uuid", "roomName": "string", "siteName": "string | null", "areaName": "string | null", "locationDescription": "string | null" } | null,
      "host": { "id": "uuid", "fullName": "string", "email": "string" } | null,
      "noteTaker": { "id": "uuid", "fullName": "string", "email": "string" } | null,
      "attendees": [
        {
          "userId": "uuid",
          "fullName": "string",
          "email": "string",
          "participantRole": "host | attendee | approver | note_taker",
          "attendanceStatus": "not_checked_in | present | absent | late | left_early",
          "joinedAt": "ISO datetime | null",
          "leftAt": "ISO datetime | null"
        }
      ]
    },
    "mainContent": {
      "minutesContent": "string",
      "decisions": "object | null",
      "actionItems": "object | null"
    },
    "relatedResources": {
      "transcript": { "id": "uuid", "status": "string", "versionNo": 1, "languageCode": "string | null" } | null,
      "recording": { "id": "uuid", "fileName": "string", "durationSeconds": "number | null", "mimeType": "string" } | null
    },
    "attachments": [
      {
        "id": "uuid",
        "fileName": "string",
        "fileType": "minutes_attachment",
        "mimeType": "string",
        "fileSizeBytes": "string",
        "uploadedBy": "uuid",
        "uploadedAt": "ISO datetime"
      }
    ],
    "preparedBy": { "id": "uuid", "fullName": "string", "email": "string" } | null,
    "issuedBy": { "id": "uuid", "fullName": "string", "email": "string" } | null,
    "issuedAt": "ISO datetime | null",
    "approvedBy": { "id": "uuid", "fullName": "string", "email": "string" } | null,
    "approvedAt": "ISO datetime | null",
    "createdAt": "ISO datetime",
    "updatedAt": "ISO datetime",
    "permissions": { "canEdit": false, "canIssue": false }
  }
}
```

### 5.4 State / Status Model
Chỉ đọc `status` (`draft/published/archived`), không có transition trong feature này.

### 5.5 Data Constraints
Không có ràng buộc dữ liệu mới. Toàn bộ trường trả về là dữ liệu đã tồn tại, không tính toán suy diễn phức tạp ngoài `permissions` (FR-017).

### 5.6 Data Lifecycle
Đọc dữ liệu tại thời điểm request (snapshot của `attendeesSnapshotJson` cố định từ UC-MKM-01; các phần khác — attachments, transcript, recording — phản ánh trạng thái mới nhất tại thời điểm gọi API, vì đây là liên kết sống qua FK, không phải snapshot).

### 5.7 Data-related EARS Requirements
Xem FR-005, FR-010, FR-011, FR-012, FR-017.

## 6. Error Handling

### 6.1 Validation Errors
- `id` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Thiếu permission `meeting.minutes.read` → 403 `FORBIDDEN`.
- Có permission nhưng không thỏa scope rule (mục 3.3) → 403 `MEETING_MINUTES_ACCESS_DENIED`.

### 6.3 Business Rule Errors
Không có (feature chỉ đọc, không có business rule chặn ghi).

### 6.4 Conflict Errors
Không áp dụng.

### 6.5 Integration / External Service Errors
Không có (không gọi external service).

### 6.6 Error Response Expectations
```jsonc
{
  "success": false,
  "message": "...",
  "error": { "code": "...", "details": {} },
  "timestamp": "...",
  "path": "..."
}
```

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN biên bản `M` có `status = published`, người gọi `U` là participant của meeting liên quan, WHEN `U` gọi GET chi tiết, THEN trả 200 với đủ 4 nhóm dữ liệu, `permissions.canEdit = false`.
- **AC-002**: GIVEN biên bản `M` có `status = draft`, `preparedBy = U`, WHEN `U` gọi GET, THEN trả 200, `permissions.canEdit = true`, `permissions.canIssue = true`.
- **AC-003**: GIVEN `M` có `linkedTranscriptId` và 2 file đính kèm active, WHEN gọi GET, THEN `relatedResources.transcript` khác null và `attachments` có đúng 2 phần tử.
- **AC-004**: GIVEN `M` chưa có file đính kèm nào (chưa dùng `feat-attach-minutes-document`), WHEN gọi GET, THEN `attachments = []` (không lỗi).

### 7.2 Authorization Cases
- **AC-005**: GIVEN `M` có `status = draft`, người gọi là Participant của meeting (không phải `preparedBy`), WHEN gọi GET, THEN trả 403 `MEETING_MINUTES_ACCESS_DENIED`.
- **AC-006**: GIVEN `M` có `status = published`, người gọi không phải host/participant/admin, WHEN gọi GET, THEN trả 403 `MEETING_MINUTES_ACCESS_DENIED`.
- **AC-007**: GIVEN người gọi có role `BUSINESS_ADMIN`, WHEN gọi GET cho `M` bất kỳ trạng thái nào, THEN luôn trả 200.
- **AC-008**: GIVEN người gọi không có permission `meeting.minutes.read`, WHEN gọi GET, THEN trả 403 `FORBIDDEN`.

### 7.3 Business Rule Cases
Không áp dụng (không có business rule chặn ghi trong feature đọc thuần túy).

### 7.4 Validation Cases
- **AC-009**: GIVEN `id` không phải UUID hợp lệ, WHEN gọi GET, THEN trả 400.

### 7.5 State Transition Cases
- **AC-010**: GIVEN `M` đã bị xóa mềm (`status = deleted`), WHEN bất kỳ ai (kể cả admin) gọi GET, THEN trả 404 `MEETING_MINUTES_NOT_FOUND`.
- **AC-011**: GIVEN `M` không tồn tại (`id` ngẫu nhiên hợp lệ UUID), WHEN gọi GET, THEN trả 404 `MEETING_MINUTES_NOT_FOUND`.

### 7.6 Notification / Audit Cases
- **AC-012**: GIVEN gọi GET thành công, THEN KHÔNG có bản ghi `audit_logs` mới nào được tạo.

### 7.7 Concurrency Cases
Không áp dụng (read-only, không có race condition cần xử lý).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-008, FR-017 |
| AC-002 | FR-007, FR-017 |
| AC-003 | FR-010, FR-012 |
| AC-004 | FR-012 |
| AC-005, AC-006 | FR-014 |
| AC-007 | FR-006 |
| AC-008 | Permission guard (mục 2.2) |
| AC-009 | FR-015 |
| AC-010, AC-011 | FR-009, FR-013 |
| AC-012 | FR-019 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Chỉnh sửa nội dung biên bản (`feat-update-draft-meeting-minutes` — chưa tồn tại).
- Ban hành chính thức biên bản (`feat-issue-meeting-minutes` — chưa tồn tại).
- Export biên bản ra PDF/Word (thuộc "Other Information" của UC gốc — cần `background_jobs` + `media_files`, làm feature riêng).
- Trigger "nhấp vào thông báo biên bản đã ban hành" (chưa có notification event tương ứng trong hệ thống — xem mục 1.4).
- Xem toàn văn transcript hoặc phát/tải trực tiếp file recording (chỉ trả reference tối thiểu, FE tự gọi API chi tiết riêng của các module đó).
- Chọn xem version cũ của biên bản (chưa có nhiều version trong thực tế, xem mục 1.4).
- Kích hoạt `visibility_level` làm cơ sở phân quyền (giữ nguyên hiện trạng chưa dùng field này, xem mục 1.5).

### 8.2 Có thể xem xét ở feature khác
- `feat-attach-minutes-document` — cung cấp dữ liệu ghi cho phần "File đính kèm" (feature này chỉ đọc).
- `feat-update-draft-meeting-minutes`, `feat-issue-meeting-minutes` — tiêu thụ cờ `permissions.canEdit/canIssue` do feature này trả về.
- `feat-export-meeting-minutes` (tên đề xuất) — nếu triển khai Export PDF/Word sau này.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cung cấp endpoint PATCH/PUT cho `meeting_minutes` trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT tạo file export (PDF/Word) trong phạm vi feature này.
- **FR-OOS-003**: THE system SHALL NOT trả toàn văn `transcripts.raw_text` trong response của feature này.

## Assumptions
Xem mục 1.4.
