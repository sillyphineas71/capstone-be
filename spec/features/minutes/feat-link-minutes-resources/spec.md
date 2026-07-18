# Feature Specification: Liên kết recording/transcript với biên bản họp (Link Minutes Resources)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo spec cho UC-141 (Feature Table), sau vòng research + Q&A trực tiếp với người dùng để chốt 3 điểm mơ hồ (phạm vi quyền, hỗ trợ hủy liên kết, thiết kế endpoint) — xem mục 1.5 | Toàn bộ file |

> Nguồn gốc: UC-141 "Liên kết recording/transcript với biên bản" (Feature Table, module Minutes & Knowledge Management). Trigger: "Người có quyền liên kết tài nguyên". Expected Output: "Biên bản tham chiếu tới media/audio/transcript cùng meeting". Pre-condition: "Tài nguyên thuộc cùng meeting_id". Related Use Cases theo Feature Table ghi UC-83/UC-93, nhưng rà soát cho thấy 2 UC đó thuộc module Attendance & Presence (hủy hiệu lực điểm danh, cảnh báo khuôn mặt lạ) — không liên quan, cùng loại lỗi cross-reference đã gặp ở UC-140. Feature này KHÔNG phụ thuộc UC-83/UC-93.

## 1. Context & Goal

### 1.1 Bối cảnh
Cột `meeting_minutes.linked_transcript_id` và `linked_recording_file_id` đã tồn tại sẵn trong baseline DB v3.2 Compact và đã được `feat-view-meeting-minutes-detail` (UC-MKM-03) đọc ra để hiển thị trong `relatedResources` — nhưng **chưa có bất kỳ luồng nào cho phép người dùng chủ động ghi 2 cột này**:
- `linked_transcript_id` chỉ được ghi tự động bởi `MinutesAiDraftProcessor` khi tạo bản nháp bằng AI từ 1 transcript có sẵn (side-effect của tính năng khác, không phải hành động "liên kết" tường minh).
- `linked_recording_file_id` chưa từng được ghi ở bất kỳ đâu trong code — hoàn toàn là cột chết cho tới nay.

Feature này lấp khoảng trống: cho phép Host chủ động chọn 1 file recording (audio/video) và/hoặc 1 transcript thuộc cùng cuộc họp để gắn vào biên bản đang soạn thảo.

### 1.2 Đánh giá sẵn sàng triển khai
Đủ điều kiện triển khai ngay — mọi phụ thuộc dữ liệu đã tồn tại:
- `meeting_minutes.linked_transcript_id`/`linked_recording_file_id` — cột đã có, không cần migration schema.
- `media_files` (recording), `transcripts` — cả 2 bảng đã có đầy đủ `meeting_id` để kiểm tra Pre-condition "cùng meeting_id".
- `feat-view-meeting-minutes-detail` đã đọc sẵn 2 cột này để hiển thị — feature này chỉ cần cung cấp đường ghi (write path), không cần sửa phần đọc.

### 1.3 Mục tiêu
Cung cấp 1 endpoint `PATCH` cho phép Host (preparedBy/meeting host) của biên bản đang `draft` gắn (hoặc gỡ) tham chiếu tới 1 file recording và/hoặc 1 transcript, với điều kiện tài nguyên đó thuộc đúng cuộc họp (`meeting_id`) của biên bản.

### 1.4 Giá trị mang lại
- Hoàn thiện phần "Tài nguyên liên quan" trong `feat-view-meeting-minutes-detail` — trước đây field luôn `null` (trừ trường hợp AI draft), giờ Host có thể tự bổ sung/sửa cho biên bản soạn tay.
- Cho Host toàn quyền kiểm soát: đổi ý chọn file recording khác, hoặc gỡ nếu gắn nhầm — không cần thao tác DB thủ công.

### 1.5 Giả định — đã giải quyết qua Q&A trực tiếp với người dùng (2026-07-17)
- **[ĐÃ GIẢI QUYẾT] Phạm vi quyền**: CHỈ Host (`preparedBy === userId` HOẶC `meeting.hostId === userId`) được liên kết/hủy liên kết. **Business Admin/System Admin KHÔNG bypass** — dù Feature Table liệt kê Business Admin là Primary Actor, người dùng chọn nhất quán với `feat-update-draft-meeting-minutes` (FR-OOS-003: admin không nên âm thầm sửa nội dung nháp của người khác), thay vì mở rộng như đã làm cho UC-139/140 (đó là hành động ĐỌC, còn đây là hành động GHI). Business Admin vẫn xem được kết quả liên kết qua UC-MKM-03 (không đổi).
  - *Ghi chú nhất quán nội bộ*: phát hiện trong lúc research rằng `feat-issue-meeting-minutes` (action ghi khác trong cùng module) LẠI cho Business Admin/System Admin bypass hoàn toàn ownership — tức bản thân codebase hiện tại không nhất quán 100% giữa các action ghi khác nhau. Feature này đi theo lựa chọn tường minh của người dùng (giống `update-draft`), không theo `issue`.
- **[ĐÃ GIẢI QUYẾT] Hủy liên kết**: CÓ hỗ trợ — truyền `null` tường minh cho field muốn gỡ (xem mục 5.2). Không có endpoint riêng cho unlink, dùng chung `PATCH .../link-resources`.
- **[ĐÃ GIẢI QUYẾT] Thiết kế endpoint**: Endpoint riêng `PATCH /api/v1/meeting-minutes/:id/link-resources`, KHÔNG gộp vào `PATCH /meeting-minutes/:id` (giữ nguyên FR-004 của `feat-update-draft-meeting-minutes` — DTO đó vẫn không nhận 2 field này).
- **[ĐỀ XUẤT — mặc định hợp lý, không hỏi lại vì đã có tiền lệ rõ]** Chỉ cho phép liên kết khi `meeting_minutes.status = draft` — nhất quán 100% với `feat-update-draft-meeting-minutes` (FR-009) và `feat-attach-minutes-document` (FR-007): mọi thao tác ghi vào biên bản đều bị khóa sau khi `published`/`archived`.
- **[ĐỀ XUẤT — mặc định hợp lý]** Thêm điều kiện `meeting.status = completed` mới cho phép liên kết — vì recording/transcript về bản chất chỉ tồn tại/có ý nghĩa đầy đủ sau khi cuộc họp đã kết thúc (nhất quán với điều kiện tương tự đã chốt ở `feat-issue-meeting-minutes` mục 1.5).
- **[ĐỀ XUẤT — mặc định hợp lý]** `recordingFileId` phải trỏ tới `media_files` có `fileType IN ('audio', 'video')` (không chấp nhận `document`/`image`/`minutes_attachment`/... — những loại đó không phải "recording"). `transcriptId` phải trỏ tới `transcripts` (không giới hạn `status`, kể cả `processing`/`draft` cũng liên kết được — Host có thể muốn gắn sớm rồi xem transcript hoàn thiện dần).
- **[ĐỀ XUẤT — mặc định hợp lý]** KHÔNG dùng optimistic lock (`versionNo`) — giống `feat-issue-meeting-minutes` (không phải nhất quán với `update-draft`): đây là hành động "set 1 tham chiếu", không ghi đè nội dung do client soạn, không có khái niệm "conflict" cần chặn theo nghĩa version.
- **[ĐỀ XUẤT — mặc định hợp lý]** KHÔNG gửi notification khi liên kết — nhất quán với `feat-attach-minutes-document` (FR-020: biên bản còn `draft`, chỉ Host thấy, không cần thông báo cho participant).
- **[NEEDS CLARIFICATION]** Nếu Host truyền `recordingFileId`/`transcriptId` **giống hệt** giá trị đang liên kết (no-op), coi là thành công (200, idempotent) hay lỗi? Spec này mặc định coi là **thành công, idempotent** (nhất quán ARCH-03) — cần Product Owner xác nhận nếu muốn khác.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host — `preparedBy` HOẶC `meeting.hostId` hiện tại của cuộc họp.
- Secondary Actor: Không có (Business Admin/System Admin không thao tác được, chỉ xem qua UC-MKM-03).

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.link_resources` (module_code=`minutes`, action_code=`minutes.link_resources`).
- Role được cấp: `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (seed đúng role code THẬT ngay từ đầu — **không** dùng `INTERNAL_USER` như các migration cũ đã seed sai, xem gap đã phát hiện ở `feat-view-minutes-attachment-detail`). Có permission là điều kiện cần nhưng chưa đủ — service còn kiểm tra ownership (mục 2.3).

### 2.3 Actor Constraints
- Chỉ Host (`preparedBy` hoặc `meeting.hostId`) mới liên kết/hủy liên kết được — Business Admin/System Admin có permission nhưng vẫn bị chặn ownership (403), dù có "recording.files.read"/"meeting.minutes.read" để xem.
- Chỉ áp dụng khi `meeting_minutes.status = draft` VÀ `meeting.status = completed`.
- `recordingFileId` (nếu truyền) phải là `media_files.id` tồn tại, chưa xóa mềm, `fileType IN (audio, video)`, VÀ `meetingId` của file đó == `meeting_minutes.meetingId`.
- `transcriptId` (nếu truyền) phải là `transcripts.id` tồn tại, VÀ `meetingId` của transcript đó == `meeting_minutes.meetingId`.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép 1 biên bản họp tham chiếu tới TỐI ĐA 1 file recording (`linked_recording_file_id`) VÀ TỐI ĐA 1 transcript (`linked_transcript_id`) tại một thời điểm — không phải danh sách nhiều tài nguyên.
- **FR-002**: THE system SHALL cho phép request chỉ truyền 1 trong 2 field (VD: chỉ đổi recording, giữ nguyên transcript hiện tại) — field không được truyền (`undefined`) SHALL giữ nguyên giá trị cũ; field truyền tường minh `null` SHALL gỡ liên kết hiện có.

### 3.2 Event-driven Requirements
- **FR-003**: WHEN Host gửi request `PATCH /meeting-minutes/:id/link-resources`, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi là `preparedBy` hoặc `meeting.hostId`, (3) `meeting_minutes.status = draft`, (4) `meeting.status = completed`, (5) nếu `recordingFileId` khác `undefined` và không null: file tồn tại/chưa xóa mềm/đúng `fileType`/đúng `meetingId`, (6) nếu `transcriptId` khác `undefined` và không null: transcript tồn tại/đúng `meetingId`, trước khi ghi.
- **FR-004**: WHEN mọi validate ở FR-003 pass, THE system SHALL UPDATE `meeting_minutes.linked_recording_file_id`/`linked_transcript_id` theo đúng field được truyền, ghi `audit_logs` (action_type=`meeting_minutes_resources_linked`), và trả về bản ghi đã cập nhật (2 field liên kết mới nhất).

### 3.3 State-driven Requirements
- **FR-005**: WHILE `meeting_minutes.status ≠ draft`, THE system SHALL từ chối mọi request liên kết/hủy liên kết (kể cả từ đúng Host), trả lỗi nghiệp vụ rõ ràng.
- **FR-006**: WHILE `meeting.status ≠ completed`, THE system SHALL từ chối request liên kết (recording/transcript chỉ có ý nghĩa đầy đủ sau khi cuộc họp kết thúc).

### 3.4 Optional Feature Requirements
- **FR-007**: WHERE request chỉ truyền `recordingFileId` (không truyền `transcriptId`), THE system SHALL giữ nguyên `linked_transcript_id` hiện tại, không đụng tới.
- **FR-008**: WHERE request truyền `recordingFileId: null` VÀ `transcriptId: null` cùng lúc, THE system SHALL gỡ cả 2 liên kết trong 1 request.

### 3.5 Unwanted Behavior Requirements
- **FR-009**: IF người gọi không phải `preparedBy` hoặc `meeting.hostId`, THEN THE system SHALL từ chối với 403 `NOT_MINUTES_OWNER` (kể cả Business Admin/System Admin).
- **FR-010**: IF `meeting_minutes.status ≠ draft`, THEN THE system SHALL từ chối với 409 `MINUTES_NOT_DRAFT`.
- **FR-011**: IF `meeting.status ≠ completed`, THEN THE system SHALL từ chối với 409 `MEETING_NOT_COMPLETED`.
- **FR-012**: IF `recordingFileId` không tồn tại/đã xóa mềm, THEN THE system SHALL từ chối với 404 `RECORDING_FILE_NOT_FOUND`.
- **FR-013**: IF `recordingFileId` có `fileType` không thuộc `(audio, video)`, THEN THE system SHALL từ chối với 400 `INVALID_RECORDING_FILE_TYPE`.
- **FR-014**: IF `recordingFileId` hoặc `transcriptId` thuộc về 1 `meeting_id` KHÁC với `meeting_minutes.meetingId`, THEN THE system SHALL từ chối với 409 `RESOURCE_NOT_SAME_MEETING`.
- **FR-015**: IF `transcriptId` không tồn tại, THEN THE system SHALL từ chối với 404 `TRANSCRIPT_NOT_FOUND`.
- **FR-016**: IF request không truyền field nào (cả `recordingFileId` và `transcriptId` đều `undefined`), THEN THE system SHALL từ chối với 400 `NO_LINK_FIELD`.

### 3.6 Workflow Requirements
- **FR-017**: THE system SHALL khóa hàng (`pessimistic_write` trên `meeting_minutes`) khi kiểm tra + cập nhật, nhất quán với `updateDraft`/`addAttachment` (tránh race condition, ví dụ Host publish đồng thời với liên kết).

### 3.7 Data & State Requirements
- **FR-018**: THE system SHALL NOT thêm cột mới vào `meeting_minutes`/`media_files`/`transcripts` (đã đủ trong baseline DB v3.2 Compact).

### 3.8 Notification / Audit Requirements
- **FR-019**: THE system SHALL ghi `audit_logs` (action_type=`meeting_minutes_resources_linked`) mỗi lần cập nhật thành công, kèm `metadataJson` = giá trị cũ và mới của 2 field.
- **FR-020**: THE system SHALL NOT gửi notification cho participants (nhất quán `feat-attach-minutes-document` FR-020).

### 3.9 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002, FR-007, FR-008 | Data model (2 cột nullable đơn, không phải bảng con danh sách) |
| FR-003, FR-009, FR-010 | Q&A 2026-07-17 (phạm vi quyền = update-draft) |
| FR-006, FR-011 | Đề xuất mặc định, tham khảo `feat-issue-meeting-minutes` mục 1.5 (meeting.status=completed) |
| FR-012, FR-013, FR-014, FR-015 | Pre-condition Feature Table "Tài nguyên thuộc cùng meeting_id" |
| FR-017 | Pattern kỹ thuật tái sử dụng từ `updateDraft`/`addAttachment` |

## 4. Non-functional Requirements

### 4.1 Performance
Endpoint phản hồi < 1s — chỉ 1-2 SELECT xác thực tài nguyên + 1 UPDATE trong transaction, không xử lý file/network ngoài.

### 4.2 Security
- JWT hợp lệ + permission `meeting.minutes.link_resources` (SEC-02).
- Validate `recordingFileId`/`transcriptId` là UUID hợp lệ (SEC-03), không dùng chuỗi nối trực tiếp vào SQL (dùng query builder/parameter binding).

### 4.3 Reliability & Consistency
Idempotent theo FR (mục 1.5, NEEDS CLARIFICATION) — truyền lại giá trị giống hệt vẫn trả 200, không lỗi giả.

### 4.4 Usability
Response trả về đủ `linkedRecordingFileId`/`linkedTranscriptId` mới nhất để FE cập nhật UI ngay, không cần gọi lại `GET /meeting-minutes/:id`.

### 4.5 Observability
Log đủ `minutesId`, `userId`, giá trị cũ/mới của 2 field, kết quả (success/lỗi + code).

### 4.6 Maintainability
Đặt method mới `linkResources` trong `MinutesService` hiện có (không tách service riêng) — logic ngắn, cùng nhóm với `updateDraft`/`addAttachment`.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` — UPDATE 2 cột đã có (`linkedTranscriptId`, `linkedRecordingFileId`), không thêm cột.
- `MediaFileEntity` — chỉ ĐỌC để validate `recordingFileId` (fileType, meetingId, deletedAt).
- `TranscriptEntity` — chỉ ĐỌC để validate `transcriptId` (meetingId).
- `AuditLogEntity` — ghi 1 dòng mỗi lần liên kết thành công.

### 5.2 Dữ liệu đầu vào

**`PATCH /api/v1/meeting-minutes/:id/link-resources`**:
```jsonc
{
  "recordingFileId": "uuid | null",   // optional — omit để giữ nguyên, null để gỡ
  "transcriptId": "uuid | null"        // optional — omit để giữ nguyên, null để gỡ
}
```
Ít nhất 1 trong 2 field phải có mặt trong request body (kể cả giá trị `null`) — xem FR-016.

### 5.3 Dữ liệu đầu ra

**Response (200)**:
```jsonc
{
  "success": true,
  "message": "Da lien ket tai nguyen voi bien ban",
  "data": {
    "id": "uuid",
    "linkedRecordingFileId": "uuid | null",
    "linkedTranscriptId": "uuid | null",
    "updatedAt": "ISO datetime"
  }
}
```

### 5.4 State / Status Model
Không có state riêng cho liên kết — chỉ 2 cột nullable trên `meeting_minutes`, bị khóa hoàn toàn bởi `status` của chính biên bản (draft-only, giống attachment).

### 5.5 Data Constraints
- `linked_recording_file_id`/`linked_transcript_id` không có DB-level FK constraint theo `meeting_id` (không thể enforce "cùng meeting" bằng SQL constraint đơn giản với schema hiện tại) — validate hoàn toàn ở tầng service (FR-014).

### 5.6 Data Lifecycle
Recording hoàn tất (`recording` module) / Transcript hoàn tất (`transcription` module) → **Liên kết (feature này)** → Hiển thị trong `relatedResources` của UC-MKM-03 → Hủy liên kết (feature này, chỉ khi còn draft) → Đóng băng sau khi `published` (không sửa được nữa, kể cả bởi Host).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-018.

## 6. Error Handling

### 6.1 Validation Errors
- Không truyền field nào → 400 `NO_LINK_FIELD`.
- `id`/`recordingFileId`/`transcriptId` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`/DTO validation).
- `recordingFileId` sai `fileType` → 400 `INVALID_RECORDING_FILE_TYPE`.

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Thiếu permission `meeting.minutes.link_resources` → 403 `FORBIDDEN`.
- Có permission nhưng không phải `preparedBy`/`meeting.hostId` → 403 `NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → 404 `MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `draft` → 409 `MINUTES_NOT_DRAFT`.
- Cuộc họp chưa `completed` → 409 `MEETING_NOT_COMPLETED`.
- `recordingFileId` không tồn tại/đã xóa mềm → 404 `RECORDING_FILE_NOT_FOUND`.
- `transcriptId` không tồn tại → 404 `TRANSCRIPT_NOT_FOUND`.
- Tài nguyên thuộc `meeting_id` khác → 409 `RESOURCE_NOT_SAME_MEETING`.

### 6.4 Conflict Errors
Xem 6.3 (`MINUTES_NOT_DRAFT`, `MEETING_NOT_COMPLETED`, `RESOURCE_NOT_SAME_MEETING`).

### 6.5 Integration / External Service Errors
Không áp dụng (không gọi service ngoài).

### 6.6 Error Response Expectations
Theo format chuẩn dự án (giống các spec khác trong `/spec/features/minutes`).

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN biên bản `M` (`status=draft`, `preparedBy=U`), meeting `Mt` (`status=completed`), file recording `F` (`fileType=video`, `meetingId=Mt.id`), WHEN `U` gọi PATCH với `recordingFileId=F.id`, THEN trả 200, `M.linkedRecordingFileId = F.id`.
- **AC-002**: GIVEN tương tự, transcript `T` (`meetingId=Mt.id`), WHEN `U` gọi PATCH với `transcriptId=T.id` (không kèm `recordingFileId`), THEN trả 200, `M.linkedTranscriptId = T.id`, `M.linkedRecordingFileId` giữ nguyên giá trị cũ.
- **AC-003**: GIVEN `M` đã có `linkedRecordingFileId = F.id`, WHEN `U` gọi PATCH với `recordingFileId: null`, THEN trả 200, `M.linkedRecordingFileId = null`.

### 7.2 Authorization Cases
- **AC-004**: GIVEN người gọi không phải `preparedBy` hoặc `meeting.hostId` của `M` (kể cả Business Admin/System Admin), WHEN gọi PATCH, THEN trả 403 `NOT_MINUTES_OWNER`.
- **AC-005**: GIVEN người gọi không có permission `meeting.minutes.link_resources`, WHEN gọi PATCH, THEN trả 403 `FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-006**: GIVEN `M` có `status = published`, WHEN `preparedBy` gọi PATCH, THEN trả 409 `MINUTES_NOT_DRAFT`.
- **AC-007**: GIVEN meeting `Mt` có `status = in_progress`, WHEN gọi PATCH, THEN trả 409 `MEETING_NOT_COMPLETED`.
- **AC-008**: GIVEN file recording `F2` thuộc `meeting_id` khác `Mt.id`, WHEN gọi PATCH với `recordingFileId=F2.id`, THEN trả 409 `RESOURCE_NOT_SAME_MEETING`.
- **AC-009**: GIVEN file `F3` có `fileType = document`, WHEN gọi PATCH với `recordingFileId=F3.id`, THEN trả 400 `INVALID_RECORDING_FILE_TYPE`.

### 7.4 Validation Cases
- **AC-010**: GIVEN request body không có `recordingFileId` lẫn `transcriptId`, WHEN gọi PATCH, THEN trả 400 `NO_LINK_FIELD`.
- **AC-011**: GIVEN `recordingFileId` không tồn tại, WHEN gọi PATCH, THEN trả 404 `RECORDING_FILE_NOT_FOUND`.
- **AC-012**: GIVEN `transcriptId` không tồn tại, WHEN gọi PATCH, THEN trả 404 `TRANSCRIPT_NOT_FOUND`.

### 7.5 State Transition Cases
Không áp dụng (không có state riêng, xem 7.3 cho ràng buộc theo status).

### 7.6 Notification / Audit Cases
- **AC-013**: GIVEN liên kết thành công, THEN có đúng 1 bản ghi `audit_logs` với `action_type = meeting_minutes_resources_linked`, `metadataJson` chứa giá trị cũ và mới.

### 7.7 Concurrency Cases
- **AC-014**: GIVEN 2 request PATCH gửi gần như đồng thời cho cùng `M`, WHEN cả 2 đều hợp lệ, THEN nhờ `pessimistic_write` lock, request thứ 2 chờ request thứ 1 commit xong mới đọc/ghi — không có race condition ghi đè ngầm.

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-002, AC-003 | FR-001, FR-002, FR-004, FR-007, FR-008 |
| AC-004 | FR-009 |
| AC-005 | Permission guard (mục 2.2) |
| AC-006 | FR-005, FR-010 |
| AC-007 | FR-006, FR-011 |
| AC-008 | FR-014 |
| AC-009 | FR-013 |
| AC-010 | FR-016 |
| AC-011 | FR-012 |
| AC-012 | FR-015 |
| AC-013 | FR-019 |
| AC-014 | FR-017 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Liên kết nhiều recording/transcript cùng lúc (danh sách) — schema chỉ có 1 cột nullable/loại, giữ nguyên giới hạn "tối đa 1 mỗi loại" của baseline DB.
- Cho phép Business Admin/System Admin liên kết hộ Host (theo quyết định Q&A 2026-07-17, xem mục 1.5).
- Liên kết/hủy liên kết sau khi biên bản đã `published`/`archived`.
- Tự động gợi ý/tự động liên kết recording hoặc transcript "gần đúng nhất" theo thời gian — feature này chỉ nhận `id` tường minh do Host chỉ định, không có logic đoán.
- Validate nội dung/chất lượng transcript trước khi cho liên kết (VD: transcript `status=failed` vẫn liên kết được — Host tự chịu trách nhiệm chọn).
- Sửa lại phần hiển thị `relatedResources` của `feat-view-meeting-minutes-detail` — không đổi (đã đọc đúng 2 cột này từ trước).

### 8.2 Có thể xem xét ở feature khác
- `feat-view-meeting-minutes-detail` (UC-MKM-03) — tiêu thụ dữ liệu từ feature này (không đổi, đã tương thích sẵn).
- Feature riêng cho phép gợi ý tự động (nếu Product Owner muốn UX tốt hơn: liệt kê sẵn danh sách recording/transcript của cùng meeting cho Host chọn thay vì tự gõ UUID) — thuộc phạm vi FE, không phải BE.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép Business Admin/System Admin liên kết/hủy liên kết tài nguyên khi họ không phải `preparedBy`/`meeting.hostId`.
- **FR-OOS-002**: THE system SHALL NOT chấp nhận nhiều hơn 1 giá trị cho mỗi loại tài nguyên (`recordingFileId`/`transcriptId`) trong 1 lần liên kết.

## Assumptions
Xem mục 1.5.
