# Feature Specification: Đính kèm tài liệu cho agenda item (Attach Meeting Agenda Document)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-04 | Khởi tạo spec, phát sinh từ `KE_HOACH_BE_AGENDA_ATTACHMENT_2026-08-04.md` — FE (`BookMeeting.jsx`, `MeetingDetail.jsx`) đã có UI "Đính kèm tài liệu thảo luận" cho từng agenda item nhưng BE chưa từng có endpoint/entity nào tiếp nhận file. | Toàn bộ file |

> Nguồn gốc: Không có UC gốc trong Feature Table cho phần đính kèm agenda (UC-MM-09 gốc chỉ mô tả text field, không có file). Phát sinh từ gap analysis khi retest luồng booking, xem `Docs/Fix_Bug_Sent_FE/BAO_CAO_AGENDA_DINH_KEM_VA_KHONG_SUA_DUOC_2026-08-04.md`.

## 1. Context & Goal

### 1.1 Bối cảnh
`feat-create-meeting-agenda` (UC-MM-09) đã cho phép Host/Organizer tạo agenda item với `title/description/ownerId/plannedDurationMinutes`, nhưng chưa có chỗ lưu file. `MeetingAgendaEntity` (bảng `meeting_agendas`) không có cột file, và `media_files` (đã dùng cho minutes attachment theo cùng pattern polymorphic `related_entity_type`/`related_entity_id`) chưa được nối vào agenda.

### 1.2 Mục tiêu
Cho phép Host/Organizer của cuộc họp tải lên và gỡ bỏ tài liệu đính kèm (PDF/Word/Excel/PowerPoint) cho từng agenda item, và cho mọi actor có quyền đọc agenda (organizer/host/participant) xem danh sách file đính kèm khi lấy agenda list — dùng lại đúng hạ tầng `media_files` + `StorageService` đã kiểm chứng ở `feat-attach-minutes-document`, không thêm bảng/cột mới.

### 1.3 Giá trị mang lại
- Khớp đúng UI đã có sẵn ở FE (`BookMeeting.jsx`/`MeetingDetail.jsx`), hiện đang lưu file cục bộ rồi không gửi đi đâu.
- Tái sử dụng nguyên vẹn pattern `media_files` polymorphic đã kiểm chứng (minutes attachment), giảm rủi ro thiết kế mới.
- Người tham gia thấy trước tài liệu thảo luận gắn với từng mục agenda thay vì chỉ có tiêu đề/mô tả text.

### 1.4 Giả định
- Meeting đã tồn tại, agenda item đã tồn tại (tạo qua `feat-create-meeting-agenda`, UC-MM-09).
- Chỉ Host/Organizer của meeting (đúng `checkAgendaWritePermission` đã có: `meetings.organizer_id` hoặc `meetings.host_id`) được upload/xóa attachment — nhất quán với quyền ghi agenda hiện tại. Không mở rộng thêm cho admin trong feature này vì `checkAgendaWritePermission` hiện tại (code sống) cũng chưa check quyền admin.
- Upload/xóa chỉ được phép khi meeting đang ở trạng thái `pending_approval` hoặc `scheduled` — tái dùng nguyên `validateMeetingStatusForAgendaWrite` đã sửa ngày 2026-08-04 (BE-06/BE-04), KHÔNG dùng lại rule "chỉ draft" của minutes (agenda không có state `draft`).
- Danh sách file đính kèm được trả về lồng trong response `GET /meetings/:meetingId/agendas` sẵn có (mỗi item agenda có thêm field `attachments`), KHÔNG tạo endpoint GET riêng — tránh N+1 bằng 1 query gộp theo `relatedEntityId IN (...)`.
- Dùng `MediaFileType.DOCUMENT` có sẵn trong enum (không cần thêm enum value mới như `MINUTES_ATTACHMENT` đã làm cho minutes).
- Tái sử dụng `StorageService` hiện có (local/S3 theo `STORAGE_DRIVER`).

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] Số lượng file tối đa/agenda item: đề xuất mặc định **5 file**, cấu hình qua `AGENDA_ATTACHMENT_MAX_COUNT` — cần Product Owner xác nhận.
- [NEEDS CLARIFICATION] Dung lượng tối đa/file: đề xuất mặc định **20MB** (đồng bộ minutes attachment), cấu hình qua `AGENDA_ATTACHMENT_MAX_BYTES`.
- [NEEDS CLARIFICATION] FE label ghi "PDF, Word, Excel, PowerPoint..." (có dấu "..."). Spec này giả định CHỈ 4 loại tài liệu văn phòng đó (không gồm ảnh) — nếu Product Owner cần thêm ảnh/định dạng khác, mở rộng allowlist ở feature sau.
- [NEEDS CLARIFICATION] Có cho phép Business Admin/System Admin thao tác thay Host không? Feature này giữ nguyên hành vi hiện tại của `checkAgendaWritePermission` (chỉ organizer/host, admin KHÔNG có bypass) — đây là gap đã biết của chính UC-MM-09 gốc, không mở rộng phạm vi trong feature này.

## 2. Actor & Roles

### 2.1 Danh sách actor
| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Host/Organizer (`meetings.host_id`/`meetings.organizer_id`) | Chủ trì/người tổ chức cuộc họp | Upload, xem, xóa attachment cho mọi agenda item của meeting mình phụ trách |
| Internal Participant | Người tham gia nội bộ | Chỉ xem attachment (qua `GET /meetings/:meetingId/agendas`), không upload/xóa |
| External Participant | Khách mời ngoài tổ chức | Không có JWT, không gọi API trong scope này (giống UC-MM-09 gốc) |

### 2.2 Role & Permission Rules
- KHÔNG thêm permission mới. Endpoint dùng `JwtAuthGuard` (giống 4 endpoint agenda hiện có: `getAgendas`/`replaceAgendas`/`updateAgendaItem`/`deleteAgendaItem` — code sống KHÔNG dùng `PermissionsGuard`/`RequirePermissions` cho nhóm agenda, chỉ check ownership trong service).
- Write (upload/xóa): tái dùng `checkAgendaWritePermission(meeting, userId)` — chỉ pass nếu `userId === meeting.organizerId` hoặc `userId === meeting.hostId`.
- Read (đọc `attachments` trong GET list): tái dùng `checkAgendaReadPermission(meetingId, userId)` — organizer/host hoặc internal participant.

### 2.3 Actor Constraints
- Phải đăng nhập hợp lệ (JWT còn hiệu lực).
- Write: phải là đúng `organizerId`/`hostId` của meeting chứa agenda item đó.
- Meeting phải tồn tại, chưa xóa mềm. Agenda item phải tồn tại và thuộc đúng meeting.
- Write: meeting phải ở trạng thái `pending_approval` hoặc `scheduled` (đồng bộ `validateMeetingStatusForAgendaWrite`).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép một agenda item (`meeting_agendas`) có nhiều bản ghi `media_files` đính kèm (0..N), liên kết qua `related_entity_type = 'meeting_agenda'` và `related_entity_id = agendaItem.id`.
- **FR-002**: THE system SHALL gán `file_type = document` cho mọi file upload qua feature này (dùng enum `MediaFileType.DOCUMENT` có sẵn, không thêm enum value mới).
- **FR-003**: THE system SHALL gán `uploaded_by = <userId người upload>` và `meeting_id = <meeting.id>` (denormalize) cho mỗi `media_files` được tạo qua feature này.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN Host/Organizer gửi request upload file cho một `agendaId` hợp lệ, THE system SHALL kiểm tra tuần tự: (1) meeting tồn tại và chưa xóa mềm, (2) người gọi là organizer/host của meeting, (3) meeting đang ở `pending_approval` hoặc `scheduled`, (4) agenda item tồn tại và thuộc đúng meeting, (5) file hợp lệ (bắt buộc, kích thước, định dạng), (6) chưa vượt số lượng file tối đa/agenda item, trước khi lưu file.
- **FR-005**: WHEN upload thành công, THE system SHALL lưu file vào storage (`StorageService`, folder `agenda-attachments`) TRƯỚC, sau đó ghi bản ghi `media_files` trong transaction; nếu ghi DB thất bại, THE system SHALL best-effort xóa file vừa lưu ở storage (tránh orphan file).
- **FR-006**: WHEN Host/Organizer gửi request xóa một attachment (`fileId`) của một `agendaId`, THE system SHALL kiểm tra: (1) meeting tồn tại, chưa xóa mềm, (2) người gọi là organizer/host, (3) meeting đang `pending_approval`/`scheduled`, (4) agenda item tồn tại và thuộc meeting, (5) file thuộc đúng `agendaId` này và chưa bị xóa mềm, trước khi soft-delete.
- **FR-007**: WHEN Host/Organizer hoặc Participant gọi `GET /meetings/:meetingId/agendas`, THE system SHALL trả kèm field `attachments` cho mỗi agenda item, truy vấn `media_files` theo `relatedEntityType='meeting_agenda' AND relatedEntityId IN (<danh sách agendaId của meeting>)` bằng MỘT query duy nhất (không N+1 theo từng item).

### 3.3 State-driven Requirements
- **FR-008**: WHILE `meetings.status` KHÔNG thuộc {`pending_approval`, `scheduled`}, THE system SHALL từ chối mọi request upload/xóa attachment (kể cả từ đúng organizer/host), trả lỗi nghiệp vụ rõ ràng — tái dùng nguyên `validateMeetingStatusForAgendaWrite`.
- **FR-009**: WHILE số lượng attachment active (chưa xóa mềm) của agenda item đã đạt `AGENDA_ATTACHMENT_MAX_COUNT`, THE system SHALL từ chối upload thêm cho đúng agenda item đó (giới hạn tính theo TỪNG agenda item, không phải theo meeting).

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE `AGENDA_ATTACHMENT_MAX_BYTES`/`AGENDA_ATTACHMENT_MAX_COUNT` được cấu hình qua `ConfigService`/env, THE system SHALL dùng giá trị cấu hình thay vì giá trị mặc định.

### 3.5 Unwanted Behavior Requirements
- **FR-011**: IF người gọi upload/xóa không phải organizer/host của meeting, THEN THE system SHALL từ chối request với 403 `AGENDA_WRITE_FORBIDDEN` (đồng bộ mã lỗi đã dùng ở `replaceAgendas`/`updateAgendaItem`/`deleteAgendaItem`).
- **FR-012**: IF người gọi đọc `GET agendas` không thỏa `checkAgendaReadPermission`, THEN THE system SHALL từ chối request với 403 `AGENDA_READ_FORBIDDEN` (không đổi hành vi hiện có).
- **FR-013**: IF file vượt quá `AGENDA_ATTACHMENT_MAX_BYTES`, THEN THE system SHALL từ chối với 400 `AGENDA_ATTACHMENT_FILE_TOO_LARGE`, KHÔNG lưu file lên storage.
- **FR-014**: IF định dạng file (`mimetype` + extension) không thuộc allowlist (`pdf, doc, docx, ppt, pptx, xls, xlsx`), THEN THE system SHALL từ chối với 400 `AGENDA_ATTACHMENT_FILE_TYPE_INVALID`.
- **FR-015**: IF không có file nào trong request upload, THEN THE system SHALL từ chối với 400 `AGENDA_ATTACHMENT_FILE_REQUIRED`.
- **FR-016**: IF `agendaId` không tồn tại hoặc không thuộc `meetingId` được chỉ định, THEN THE system SHALL trả 404 `AGENDA_ITEM_NOT_FOUND`.
- **FR-017**: IF `fileId` không tồn tại, đã xóa mềm, hoặc không thuộc `agendaId` được chỉ định, THEN THE system SHALL trả 404 `AGENDA_ATTACHMENT_NOT_FOUND` khi xóa.
- **FR-018**: IF meeting không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả 404 `MEETING_NOT_FOUND`.

### 3.6 Workflow Requirements
- **FR-019**: THE system SHALL thực hiện ghi `media_files` + `audit_logs` trong cùng một transaction khi upload/xóa thành công; lưu file vật lý xảy ra ngoài transaction DB (trước khi insert, theo đúng pattern `MinutesService.addAttachment`).
- **FR-020**: THE system SHALL khóa hàng (`pessimistic_write` trên `meetings`) khi kiểm tra + tăng số lượng attachment trong transaction upload, để tránh race condition vượt `AGENDA_ATTACHMENT_MAX_COUNT` khi có nhiều request upload đồng thời cho cùng agenda item.

### 3.7 Data & State Requirements
- **FR-021**: THE system SHALL NOT thêm cột mới vào `meeting_agendas` hoặc `media_files` (đã đủ trong baseline DB v3.2 Compact — dùng `related_entity_type`/`related_entity_id` có sẵn).
- **FR-022**: Xóa attachment SHALL là soft-delete (`media_files.deleted_at`), KHÔNG hard-delete bản ghi DB; file vật lý trên storage CÓ THỂ bị xóa thật (best-effort, không chặn response nếu xóa storage lỗi — log cảnh báo).

### 3.8 Notification / Audit Requirements
- **FR-023**: THE system SHALL ghi `audit_logs` (`action_type = meeting_agenda_attachment_uploaded`, `entity_type = meeting_agenda`, `entity_id = agendaId`) khi upload thành công, và (`action_type = meeting_agenda_attachment_deleted`) khi xóa thành công.
- **FR-024**: THE system SHALL NOT gửi notification cho participants khi thêm/xóa attachment (ngoài phạm vi feature này — đồng bộ UC-MM-09 gốc: notification agenda là deferred).

### 3.9 Complex / Combined Requirements
- **FR-025**: IF `meeting.status ∈ {pending_approval, scheduled}` AND người gọi là organizer/host AND file hợp lệ AND chưa vượt giới hạn số lượng cho agenda item đó, THEN THE system SHALL upload file, tạo `media_files` với `relatedEntityType='meeting_agenda'`, `relatedEntityId=agendaId`, và trả về bản ghi vừa tạo.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002, FR-003 | Gap analysis `KE_HOACH_BE_AGENDA_ATTACHMENT_2026-08-04.md` mục 1, 2, 3 (PA-1) |
| FR-007 | `KE_HOACH_BE_AGENDA_ATTACHMENT_2026-08-04.md` mục 3, bullet 3 (gộp attachments vào GET agendas, tránh N+1) |
| FR-008, FR-011, FR-012 | Tái dùng `checkAgendaWritePermission`/`checkAgendaReadPermission`/`validateMeetingStatusForAgendaWrite` của `feat-create-meeting-agenda` (UC-MM-09) |
| FR-005, FR-019, FR-020 | Pattern kỹ thuật tái sử dụng từ `feat-attach-minutes-document`/`MinutesService.addAttachment` |
| FR-009, FR-013, FR-014 | Business rule mới, đề xuất tại mục 1.5 (cần Product Owner xác nhận số liệu) |

## 4. Non-functional Requirements

### 4.1 Performance
- Upload API phản hồi < 2s cho file ≤ 20MB trong điều kiện local storage bình thường (đồng bộ chấp nhận được theo ARCH-02, không cần `background_jobs`).
- `GET /meetings/:meetingId/agendas` với attachments KHÔNG được phát sinh N+1 query (FR-007) — bắt buộc 1 query `IN (...)` cho toàn bộ agenda item của meeting.

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02); ownership check ở service (organizer/host).
- Validate `mimetype`/extension theo allowlist, không tin tưởng tuyệt đối `mimetype` client gửi (SEC-03) — kiểm tra khớp extension/mimetype giống `MinutesService.addAttachment`.
- Chống path traversal khi lưu/đọc file: dùng `StorageService` sẵn có.
- Không log nội dung file, chỉ log metadata (tên, kích thước, mimetype).

### 4.3 Reliability & Consistency
- Idempotency: xóa 1 file đã xóa trước đó (gọi lại DELETE) trả 404 `AGENDA_ATTACHMENT_NOT_FOUND` thay vì lỗi 500.
- Không để orphan file trên storage khi DB transaction thất bại (FR-005).

### 4.4 Usability
- Response upload trả đủ thông tin để FE hiển thị ngay (tên file, kích thước, loại, URL) mà không cần gọi thêm API.

### 4.5 Observability
- Log đủ: `meetingId`, `agendaId`, `userId`, `fileId`, kết quả (success/lỗi + code) cho cả upload/xóa.

### 4.6 Maintainability
- Business logic đặt trong `MeetingsService` hiện có (cùng file với các method agenda khác: `getAgendas`/`replaceAgendas`/`updateAgendaItem`/`deleteAgendaItem`), đặt liền sau `deleteAgendaItem` — không tách service riêng vì logic ngắn (đồng nhất cách tổ chức code agenda hiện tại).

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingEntity` (bảng `meetings`) — đọc + lock để check status/ownership, không thêm cột.
- `MeetingAgendaEntity` (bảng `meeting_agendas`) — chỉ đọc (xác nhận agenda item tồn tại/thuộc meeting), không thêm cột.
- `MediaFileEntity` (bảng `media_files`) — tạo mới (upload)/soft-delete (xóa)/đọc (list gộp trong GET agendas).
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng mỗi thao tác upload/xóa.

### 5.2 Dữ liệu đầu vào

**Upload** — `POST /api/v1/meetings/:meetingId/agendas/:agendaId/attachments` (multipart/form-data):
```jsonc
{ "file": "binary, required, ≤ AGENDA_ATTACHMENT_MAX_BYTES" }
```

**Delete** — `DELETE /api/v1/meetings/:meetingId/agendas/:agendaId/attachments/:fileId`: không có body.

**List** — không có endpoint riêng; lồng trong `GET /api/v1/meetings/:meetingId/agendas` hiện có (xem FR-007).

### 5.3 Dữ liệu đầu ra

**Upload response (201)**:
```jsonc
{
  "success": true,
  "message": "Da dinh kem tai lieu thanh cong",
  "data": {
    "id": "uuid",
    "agendaId": "uuid",
    "meetingId": "uuid",
    "fileName": "string",
    "mimeType": "string",
    "fileSizeBytes": "string",
    "fileUrl": "string",
    "uploadedBy": "uuid",
    "uploadedAt": "ISO datetime"
  }
}
```

**Delete response (200)**:
```jsonc
{
  "success": true,
  "message": "Da go tai lieu dinh kem",
  "data": { "fileId": "uuid", "agendaId": "uuid", "deletedAt": "ISO datetime" }
}
```

**GET agendas response (mở rộng, mỗi item thêm `attachments`)**:
```jsonc
{
  "items": [
    {
      "id": "uuid",
      "title": "...",
      "attachments": [
        {
          "id": "uuid",
          "fileName": "string",
          "mimeType": "string",
          "fileSizeBytes": "string",
          "fileUrl": "string",
          "uploadedBy": "uuid",
          "uploadedAt": "ISO datetime"
        }
      ]
    }
  ]
}
```

### 5.4 State / Status Model
Không có state riêng cho attachment (chỉ active/soft-deleted qua `deleted_at`). Thao tác write bị khóa hoàn toàn bởi state của **meeting cha** (`pending_approval`/`scheduled`).

### 5.5 Data Constraints
- Business constraint (tầng service, không phải DB constraint): tối đa `AGENDA_ATTACHMENT_MAX_COUNT` file active/agenda item.
- `related_entity_type` luôn là chuỗi cố định `'meeting_agenda'` cho feature này.

### 5.6 Data Lifecycle
Upload (feature này) → hiển thị trong `GET /meetings/:meetingId/agendas` (FR-007) → Xóa (feature này, chỉ khi meeting còn `pending_approval`/`scheduled`).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-003, FR-021, FR-022.

## 6. Error Handling

### 6.1 Validation Errors
- Không có file trong request → 400 `AGENDA_ATTACHMENT_FILE_REQUIRED`.
- File vượt kích thước → 400 `AGENDA_ATTACHMENT_FILE_TOO_LARGE`.
- Định dạng không hợp lệ → 400 `AGENDA_ATTACHMENT_FILE_TYPE_INVALID`.
- `meetingId`/`agendaId`/`fileId` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Upload/Xóa: không phải organizer/host → 403 `AGENDA_WRITE_FORBIDDEN`.
- Đọc (trong GET agendas): không thỏa `checkAgendaReadPermission` → 403 `AGENDA_READ_FORBIDDEN`.

### 6.3 Business Rule Errors
- Meeting không tồn tại/đã xóa mềm → 404 `MEETING_NOT_FOUND`.
- Agenda item không tồn tại/không thuộc meeting → 404 `AGENDA_ITEM_NOT_FOUND`.
- Meeting không ở `pending_approval`/`scheduled` → 409 `AGENDA_MEETING_STATUS_BLOCKED`.
- Đã đạt số lượng file tối đa cho agenda item → 409 `AGENDA_ATTACHMENT_LIMIT_EXCEEDED`.

### 6.4 Conflict Errors
Xem 6.3 (`AGENDA_MEETING_STATUS_BLOCKED`, `AGENDA_ATTACHMENT_LIMIT_EXCEEDED`).

### 6.5 Integration / External Service Errors
- Lưu file thất bại (storage local/S3 lỗi) → 502 `AGENDA_ATTACHMENT_STORAGE_FAILED`, không tạo bản ghi `media_files`.

### 6.6 Error Response Expectations
Theo format chuẩn dự án:
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
- **AC-001**: GIVEN meeting `M` ở trạng thái `scheduled`, agenda item `A` thuộc `M`, người gọi là host của `M`, WHEN host upload 1 file PDF hợp lệ cho `A`, THEN hệ thống trả 201 với `relatedEntityType='meeting_agenda'`, `relatedEntityId=A.id`.
- **AC-002**: GIVEN `A` đã có 2 attachment active, WHEN bất kỳ participant nào của `M` gọi `GET /meetings/:meetingId/agendas`, THEN response chứa item `A` với `attachments` có đúng 2 phần tử, thứ tự `uploadedAt DESC`.
- **AC-003**: GIVEN attachment `F` thuộc `A`, WHEN host gọi DELETE `F`, THEN trả 200, `F.deletedAt` được set, không còn xuất hiện trong `attachments` của GET agendas sau đó.

### 7.2 Authorization Cases
- **AC-004**: GIVEN người gọi không phải organizer/host của `M` (kể cả participant), WHEN gọi upload/xóa, THEN trả 403 `AGENDA_WRITE_FORBIDDEN`.
- **AC-005**: GIVEN người gọi chưa đăng nhập, WHEN gọi bất kỳ endpoint nào trong feature, THEN trả 401.

### 7.3 Business Rule Cases
- **AC-006**: GIVEN `M` ở trạng thái `in_progress`/`cancelled`/`completed`, WHEN host gọi upload, THEN trả 409 `AGENDA_MEETING_STATUS_BLOCKED`.
- **AC-007**: GIVEN `A` đã có đúng `AGENDA_ATTACHMENT_MAX_COUNT` file active, WHEN host upload thêm 1 file cho `A`, THEN trả 409 `AGENDA_ATTACHMENT_LIMIT_EXCEEDED`.

### 7.4 Validation Cases
- **AC-008**: GIVEN file dung lượng > `AGENDA_ATTACHMENT_MAX_BYTES`, WHEN upload, THEN trả 400 `AGENDA_ATTACHMENT_FILE_TOO_LARGE`.
- **AC-009**: GIVEN file định dạng `.exe`, WHEN upload, THEN trả 400 `AGENDA_ATTACHMENT_FILE_TYPE_INVALID`.
- **AC-010**: GIVEN request không kèm file, WHEN upload, THEN trả 400 `AGENDA_ATTACHMENT_FILE_REQUIRED`.

### 7.5 State Transition Cases
- **AC-011**: GIVEN `fileId` đã bị xóa mềm trước đó, WHEN gọi DELETE lại cùng `fileId`, THEN trả 404 `AGENDA_ATTACHMENT_NOT_FOUND`.
- **AC-012**: GIVEN `agendaId` không thuộc `meetingId` trong path, WHEN gọi upload/xóa, THEN trả 404 `AGENDA_ITEM_NOT_FOUND`.

### 7.6 Notification / Audit Cases
- **AC-013**: GIVEN upload thành công, THEN có đúng 1 bản ghi `audit_logs` với `action_type = meeting_agenda_attachment_uploaded`.
- **AC-014**: GIVEN xóa thành công, THEN có đúng 1 bản ghi `audit_logs` với `action_type = meeting_agenda_attachment_deleted`.

### 7.7 Concurrency Cases
- **AC-015**: GIVEN `A` còn 1 slot trống trước khi đạt `AGENDA_ATTACHMENT_MAX_COUNT`, WHEN 2 request upload gửi gần như đồng thời cho `A`, THEN chỉ 1 request thành công (201), request còn lại nhận 409 `AGENDA_ATTACHMENT_LIMIT_EXCEEDED` (đảm bảo bằng lock `pessimistic_write` trên `meetings`, xem FR-020).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-002, FR-003, FR-025 |
| AC-002 | FR-007 |
| AC-003 | FR-006, FR-022 |
| AC-004 | FR-011 |
| AC-005 | Guard `JwtAuthGuard` |
| AC-006 | FR-008 |
| AC-007, AC-015 | FR-009, FR-020 |
| AC-008 | FR-013 |
| AC-009 | FR-014 |
| AC-010 | FR-015 |
| AC-011 | FR-017 |
| AC-012 | FR-016 |
| AC-013, AC-014 | FR-023 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Endpoint `GET` liệt kê attachment riêng cho 1 agenda item — dữ liệu đã lồng sẵn trong `GET /meetings/:meetingId/agendas` (FR-007).
- Xem chi tiết/download 1 file cụ thể qua signed URL riêng — tái dùng cơ chế đã có cho `media_files` nếu FE cần (`GET /media-files/:fileId`), ngoài phạm vi feature này.
- Cho phép Business Admin/System Admin thao tác thay Host (giữ nguyên gap đã biết của `checkAgendaWritePermission`).
- Đổi tên file, thêm mô tả/caption cho từng attachment.
- Ảnh/hình minh họa trong allowlist (chỉ 4 loại tài liệu văn phòng, xem 1.5).
- Notification khi thêm/xóa attachment.
- Virus scanning / deep content inspection.
- Thêm bảng/cột database mới.

### 8.2 Có thể xem xét ở feature khác
- `feat-create-meeting-agenda` (UC-MM-09) — tiêu thụ dữ liệu `attachments` khi hiển thị GET agendas (đã cover ở feature này, nhưng phần UI/FE nối dây là việc khác).
- Endpoint xem chi tiết 1 attachment cụ thể (giống UC-140 của minutes, `feat-view-minutes-attachment-detail`) nếu FE cần sau này.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép upload/xóa attachment khi `meetings.status` KHÔNG thuộc {`pending_approval`, `scheduled`} trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT cung cấp endpoint sửa/đổi tên attachment đã upload (chỉ upload mới hoặc xóa).
- **FR-OOS-003**: THE system SHALL NOT tạo bảng hoặc cột database mới cho feature này.

## Assumptions
Xem mục 1.4.
