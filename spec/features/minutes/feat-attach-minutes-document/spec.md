# Feature Specification: Đính kèm tài liệu vào biên bản họp (Attach Minutes Document)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec, phát sinh từ gap analysis khi rà soát UC-MKM-03 (Xem chi tiết biên bản họp) — UC gốc mô tả "Danh sách file đính kèm" nhưng chưa có use case nào trong Feature Table tạo ra dữ liệu này | Toàn bộ file |

> Nguồn gốc: **Không có UC gốc trong Feature Table.** Phát sinh từ phân tích UC-MKM-03 "Xem chi tiết biên bản họp": UC đó mô tả phần "File đính kèm: Danh sách các tài liệu, slide báo cáo, hình ảnh được tải lên đi kèm biên bản", nhưng rà soát code (`MeetingMinutesEntity`, `MinutesService.createDraft`) cho thấy không có bất kỳ luồng nào ghi dữ liệu vào đó — `CreateDraftMinutesDto` chỉ nhận `title`. Feature này bổ sung phần còn thiếu, tạm đặt tên **UC-MKM-0x (mới)**, chờ Product Owner gán số chính thức trong Feature Table.

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi Host tạo biên bản họp nháp (`feat-create-draft-meeting-minutes`, UC-MKM-01), Host cần đính kèm tài liệu bổ trợ (slide báo cáo, file Word/PDF, hình ảnh minh họa) vào biên bản trước khi ban hành chính thức. Hiện tại bảng `meeting_minutes` chỉ có 1 cột `file_id` (single FK, dự kiến dành cho file biên bản chính thức export ra sau này — ngoài phạm vi feature này), còn `media_files` đã có sẵn cơ chế polymorphic (`related_entity_type` + `related_entity_id`) và enum `MediaFileType.MINUTES_ATTACHMENT` dành riêng cho việc này nhưng chưa được implement ở đâu.

### 1.2 Mục tiêu
Cho phép Host (người tạo/sở hữu biên bản, `preparedBy`) tải lên, xem danh sách, và gỡ bỏ nhiều tài liệu đính kèm cho một biên bản đang ở trạng thái DRAFT, dùng lại đúng hạ tầng `media_files` + `StorageService` đã có trong dự án (không thêm bảng mới).

### 1.3 Giá trị mang lại
- Lấp khoảng trống dữ liệu cho phần "File đính kèm" mà UC-MKM-03 (Xem chi tiết biên bản họp) cần hiển thị.
- Tái sử dụng đúng pattern đã kiểm chứng (avatar submission: `relatedEntityType/relatedEntityId`, transaction, pre-generate UUID), không phát sinh thiết kế mới.

### 1.4 Giả định
- Biên bản họp (`meeting_minutes`) đã tồn tại và ở trạng thái `draft`, được tạo qua `feat-create-draft-meeting-minutes` (UC-MKM-01).
- Chỉ **Host/preparedBy** của biên bản được thao tác đính kèm (không mở rộng cho Participant, Business Admin ở phiên bản v1 — nhất quán với BR1 của UC-MKM-01: bản nháp chỉ Host thấy/sửa).
- Việc đính kèm/gỡ file chỉ cho phép khi biên bản còn ở trạng thái `draft`. Sau khi ban hành (`published`)/lưu trữ (`archived`), biên bản coi như đóng băng — chỉnh sửa file đính kèm sau khi ban hành là ngoài phạm vi (xem mục 8).
- Không dùng `meeting_minutes.file_id` trong feature này — cột đó để dành cho file biên bản chính thức export (feature khác, ngoài phạm vi).
- Tái sử dụng `StorageService` hiện có (local/S3 theo `STORAGE_DRIVER`), không dùng Cloudinary (Cloudinary chỉ dành cho ảnh avatar/face theo CLAUDE.md).

### 1.5 Cần làm rõ
- [NEEDS CLARIFICATION] Số lượng file tối đa/biên bản: spec này đề xuất mặc định **10 file**, cấu hình qua `MINUTES_ATTACHMENT_MAX_COUNT` — cần Product Owner xác nhận con số phù hợp.
- [NEEDS CLARIFICATION] Dung lượng tối đa/file: đề xuất mặc định **20MB**, cấu hình qua `MINUTES_ATTACHMENT_MAX_BYTES` — cần xác nhận.
- [NEEDS CLARIFICATION] Có cho phép đính kèm/gỡ file sau khi biên bản đã `published` không (ví dụ bổ sung tài liệu muộn)? Feature này giả định KHÔNG; nếu cần, phải làm feature riêng có audit rõ ràng (biên bản đã ban hành nên tránh thay đổi ngầm).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host/`preparedBy` của biên bản.
- Secondary Actor: Không có.

### 2.2 Role & Permission Rules
- Permission code mới:
  - `meeting.minutes.attachment.create` (upload)
  - `meeting.minutes.attachment.read` (xem danh sách)
  - `meeting.minutes.attachment.delete` (gỡ file)
- Role mặc định được cấp cả 3 permission: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (theo đúng convention của `meeting.minutes.create`/`meeting.minutes.read`).
- Giống UC-MKM-01: sở hữu permission là điều kiện cần nhưng chưa đủ — service còn kiểm tra **resource ownership** (`minutes.preparedBy === authUser.userId`) theo SEC-02 của Constitution.

### 2.3 Actor Constraints
- Người không phải `preparedBy` của biên bản (kể cả Business Admin/System Admin) **không** được upload/xóa attachment qua endpoint này ở v1 (nhất quán với việc chỉ Host được sửa bản nháp).
- Nếu biên bản không còn ở trạng thái `draft`, mọi thao tác ghi (upload/xóa) đều bị từ chối — kể cả với đúng `preparedBy`.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép một biên bản họp (`meeting_minutes`) có nhiều bản ghi `media_files` đính kèm (0..N), liên kết qua `related_entity_type = 'meeting_minutes'` và `related_entity_id = meetingMinutes.id`.
- **FR-002**: THE system SHALL gán `file_type = minutes_attachment` cho mọi file upload qua feature này.
- **FR-003**: THE system SHALL gán `uploaded_by = <userId người upload>` và `meeting_id = <meetingMinutes.meetingId>` (denormalize để tiện truy vấn theo meeting) cho mỗi `media_files` được tạo.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN Host gửi request upload file cho một `minutesId` hợp lệ, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi là `preparedBy` của biên bản, (3) biên bản đang ở trạng thái `draft`, (4) file có mặt và hợp lệ (kích thước, định dạng), (5) chưa vượt số lượng file tối đa, trước khi lưu file.
- **FR-005**: WHEN upload thành công, THE system SHALL lưu file vào storage (qua `StorageService`, folder `minutes-attachments`) TRƯỚC, sau đó mới ghi bản ghi `media_files` trong transaction; nếu ghi DB thất bại, THE system SHALL best-effort xóa file vừa lưu ở storage (tránh orphan file), theo đúng pattern `AvatarSubmissionService.cleanupCloudinary`.
- **FR-006**: WHEN Host gửi request xóa một attachment (`fileId`) của một `minutesId`, THE system SHALL kiểm tra: (1) biên bản tồn tại, (2) người gọi là `preparedBy`, (3) biên bản đang `draft`, (4) file thuộc đúng biên bản này (`relatedEntityId = minutesId`) và chưa bị xóa mềm, trước khi soft-delete.

### 3.3 State-driven Requirements
- **FR-007**: WHILE `meeting_minutes.status ≠ draft`, THE system SHALL từ chối mọi request upload/xóa attachment (kể cả từ đúng `preparedBy`), trả lỗi nghiệp vụ rõ ràng (không cho sửa biên bản đã ban hành/lưu trữ).
- **FR-008**: WHILE số lượng attachment active (chưa xóa mềm) của biên bản đã đạt `MINUTES_ATTACHMENT_MAX_COUNT`, THE system SHALL từ chối upload thêm.

### 3.4 Optional Feature Requirements
- **FR-009**: WHERE Host không truyền `description`/ghi chú cho file (nếu DTO hỗ trợ), THE system SHALL lưu `metadataJson = null`.

### 3.5 Unwanted Behavior Requirements
- **FR-010**: IF người gọi không phải `preparedBy` của biên bản, THEN THE system SHALL từ chối request với 403 `NOT_MINUTES_OWNER`.
- **FR-011**: IF file vượt quá `MINUTES_ATTACHMENT_MAX_BYTES`, THEN THE system SHALL từ chối với 400 `ATTACHMENT_FILE_TOO_LARGE`, KHÔNG lưu file lên storage.
- **FR-012**: IF định dạng file (theo `mimetype` + extension) không thuộc allowlist (`pdf, doc, docx, ppt, pptx, xls, xlsx, png, jpg, jpeg`), THEN THE system SHALL từ chối với 400 `ATTACHMENT_FILE_TYPE_INVALID`.
- **FR-013**: IF không có file nào trong request upload, THEN THE system SHALL từ chối với 400 `ATTACHMENT_FILE_REQUIRED`.
- **FR-014**: IF `fileId` không tồn tại, đã xóa mềm, hoặc không thuộc `minutesId` được chỉ định, THEN THE system SHALL trả 404 `ATTACHMENT_NOT_FOUND` khi xóa.

### 3.6 Workflow Requirements
- **FR-015**: THE system SHALL thực hiện việc ghi `media_files` + `audit_logs` trong cùng một transaction khi upload thành công (nhất quán với ARCH-03 của dự án); lưu file vật lý xảy ra ngoài transaction (trước), theo đúng pattern đã dùng ở avatar submission.
- **FR-016**: THE system SHALL khóa hàng (`pessimistic_write` trên `meeting_minutes`) khi kiểm tra + tăng số lượng attachment, để tránh race condition vượt `MINUTES_ATTACHMENT_MAX_COUNT` khi có nhiều request upload đồng thời.

### 3.7 Data & State Requirements
- **FR-017**: THE system SHALL NOT thêm cột mới vào `meeting_minutes` hoặc `media_files` (đã đủ trong baseline DB v3.2 Compact).
- **FR-018**: Xóa attachment SHALL là soft-delete (`media_files.deleted_at`), KHÔNG hard-delete bản ghi DB; file vật lý trên storage CÓ THỂ bị xóa thật (best-effort, không chặn response nếu xóa storage lỗi — log cảnh báo).

### 3.8 Notification / Audit Requirements
- **FR-019**: THE system SHALL ghi `audit_logs` (action_type = `meeting_minutes_attachment_uploaded`) khi upload thành công, và (action_type = `meeting_minutes_attachment_deleted`) khi xóa thành công.
- **FR-020**: THE system SHALL NOT gửi notification cho participants khi thêm/xóa attachment (biên bản còn ở trạng thái draft, chỉ Host nhìn thấy — nhất quán FR-019 của UC-MKM-01).

### 3.9 Complex / Combined Requirements
- **FR-021**: IF `minutes.status = draft` AND người gọi là `preparedBy` AND file hợp lệ AND chưa vượt giới hạn số lượng, THEN THE system SHALL upload file, tạo `media_files` với `relatedEntityType = 'meeting_minutes'`, `relatedEntityId = minutesId`, và trả về danh sách attachment cập nhật (hoặc bản ghi vừa tạo).

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002, FR-003 | Gap analysis UC-MKM-03 mục "File đính kèm" |
| FR-007, FR-010 | Giả định 1.4 (chỉ Host, chỉ khi draft) — nhất quán BR1 của UC-MKM-01 |
| FR-008, FR-011, FR-012, FR-013 | Business rule mới, đề xuất tại mục 1.5 (cần Product Owner xác nhận) |
| FR-005, FR-015, FR-016 | Pattern kỹ thuật tái sử dụng từ `feat-user-avatar-submission-reminder`/`AvatarSubmissionService` |

## 4. Non-functional Requirements

### 4.1 Performance
- Upload API phản hồi < 2s cho file ≤ 20MB trong điều kiện local storage bình thường (không cần đưa vào `background_jobs` — file nhỏ, đồng bộ chấp nhận được, theo ARCH-02 chỉ bắt buộc async khi >2s).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ + permission tương ứng (SEC-02).
- Validate `mimetype`/extension theo allowlist, không tin tưởng tuyệt đối `mimetype` client gửi lên (SEC-03) — tối thiểu kiểm tra khớp giữa extension và `mimetype` khai báo; không bắt buộc magic-byte deep inspection như ảnh avatar (tài liệu văn phòng đa dạng định dạng hơn).
- Chống path traversal khi lưu/đọc file: dùng `StorageService` sẵn có (đã có kiểm tra base path).
- Không log nội dung file, chỉ log metadata (tên, kích thước, mimetype).

### 4.3 Reliability & Consistency
- Idempotency: xóa 1 file đã xóa trước đó (gọi lại DELETE) trả 404 `ATTACHMENT_NOT_FOUND` thay vì lỗi 500.
- Không để orphan file trên storage khi DB transaction thất bại (FR-005).

### 4.4 Usability
- Response của upload trả về đủ thông tin để FE hiển thị ngay (tên file, kích thước, loại, URL xem/tải) mà không cần gọi thêm API.

### 4.5 Observability
- Log đủ: `minutesId`, `userId`, `fileId`, kết quả (success/lỗi + code) cho cả 3 thao tác.

### 4.6 Maintainability
- Business logic đặt trong `MinutesService` (hoặc service con `MinutesAttachmentService` nếu file `minutes.service.ts` quá dài — xem plan.md mục 2.3), tách biệt khỏi `MediaFilesService` hiện có (module `recording`) — chỉ tái sử dụng `MediaFileEntity`/`StorageService`, không sửa `MediaFilesService`.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc + lock để check status/ownership, không thêm cột.
- `MediaFileEntity` (bảng `media_files`) — tạo mới (upload) / soft-delete (xóa) / đọc (list).
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng mỗi thao tác upload/xóa.

### 5.2 Dữ liệu đầu vào

**Upload** — `POST /api/v1/meeting-minutes/:minutesId/attachments` (multipart/form-data):
```jsonc
{
  "file": "binary, required, ≤ MINUTES_ATTACHMENT_MAX_BYTES"
}
```

**List** — `GET /api/v1/meeting-minutes/:minutesId/attachments`: không có body, chỉ path param.

**Delete** — `DELETE /api/v1/meeting-minutes/:minutesId/attachments/:fileId`: không có body.

### 5.3 Dữ liệu đầu ra

**Upload response (201)**:
```jsonc
{
  "success": true,
  "message": "Tai lieu da duoc dinh kem thanh cong",
  "data": {
    "id": "uuid",
    "fileName": "string",
    "fileType": "minutes_attachment",
    "mimeType": "string",
    "fileSizeBytes": "string",
    "fileUrl": "string",
    "uploadedBy": "uuid",
    "uploadedAt": "ISO datetime"
  }
}
```

**List response (200)**:
```jsonc
{
  "success": true,
  "message": "Danh sach tai lieu dinh kem",
  "data": [
    {
      "id": "uuid",
      "fileName": "string",
      "fileType": "minutes_attachment",
      "mimeType": "string",
      "fileSizeBytes": "string",
      "fileUrl": "string",
      "uploadedBy": "uuid",
      "uploadedAt": "ISO datetime"
    }
  ],
  "meta": { "total": 0, "maxCount": 10 }
}
```

**Delete response (200)**:
```jsonc
{
  "success": true,
  "message": "Da go tai lieu dinh kem",
  "data": { "fileId": "uuid", "deletedAt": "ISO datetime" }
}
```

### 5.4 State / Status Model
Không có state riêng cho attachment (chỉ active/soft-deleted qua `deleted_at`). Thao tác bị khóa hoàn toàn bởi state của **biên bản cha** (`meeting_minutes.status = draft`).

### 5.5 Data Constraints
- Business constraint (tầng service, không phải DB constraint): tối đa `MINUTES_ATTACHMENT_MAX_COUNT` file active/biên bản.
- `related_entity_type` luôn là chuỗi cố định `'meeting_minutes'` cho feature này.

### 5.6 Data Lifecycle
Upload (feature này) → hiển thị trong UC-MKM-03 (Xem chi tiết biên bản, ngoài phạm vi feature này) → Xóa (feature này, chỉ khi còn draft) → (ngoài phạm vi) khóa vĩnh viễn sau khi biên bản `published`.

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-003, FR-017, FR-018.

## 6. Error Handling

### 6.1 Validation Errors
- Không có file trong request → 400 `ATTACHMENT_FILE_REQUIRED`.
- File vượt kích thước → 400 `ATTACHMENT_FILE_TOO_LARGE`.
- Định dạng không hợp lệ → 400 `ATTACHMENT_FILE_TYPE_INVALID`.
- `minutesId`/`fileId` không phải UUID hợp lệ → 400 (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → 401.
- Thiếu permission tương ứng → 403 `FORBIDDEN`.
- Có permission nhưng không phải `preparedBy` → 403 `NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → 404 `MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `draft` → 409 `MINUTES_NOT_DRAFT`.
- Đã đạt số lượng file tối đa → 409 `ATTACHMENT_LIMIT_EXCEEDED`.

### 6.4 Conflict Errors
Xem 6.3 (`MINUTES_NOT_DRAFT`, `ATTACHMENT_LIMIT_EXCEEDED`).

### 6.5 Integration / External Service Errors
- Lưu file thất bại (storage local/S3 lỗi) → 502 `ATTACHMENT_STORAGE_FAILED`, không tạo bản ghi `media_files`.

### 6.6 Error Response Expectations
Theo format chuẩn dự án (giống spec `feat-create-draft-meeting-minutes` mục 6.6):
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
- **AC-001**: GIVEN biên bản `M` có `status = draft`, `preparedBy = U`, WHEN `U` upload 1 file PDF hợp lệ, THEN hệ thống trả 201 với `fileType = minutes_attachment`, `relatedEntityId = M.id`.
- **AC-002**: GIVEN `M` đã có 2 attachment active, WHEN `U` gọi GET list, THEN trả 200 với 2 phần tử, đúng thứ tự `uploadedAt DESC`.
- **AC-003**: GIVEN attachment `F` thuộc `M`, WHEN `U` gọi DELETE `F`, THEN trả 200, `F.deletedAt` được set, không còn xuất hiện trong GET list sau đó.

### 7.2 Authorization Cases
- **AC-004**: GIVEN người gọi không phải `preparedBy` của `M` (kể cả Participant/Business Admin), WHEN gọi upload/delete, THEN trả 403 `NOT_MINUTES_OWNER`.
- **AC-005**: GIVEN người gọi không có permission tương ứng, WHEN gọi bất kỳ endpoint nào trong feature, THEN trả 403 `FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-006**: GIVEN `M` có `status = published`, WHEN `preparedBy` gọi upload, THEN trả 409 `MINUTES_NOT_DRAFT`.
- **AC-007**: GIVEN `M` đã có đúng `MINUTES_ATTACHMENT_MAX_COUNT` file active, WHEN `preparedBy` upload thêm 1 file, THEN trả 409 `ATTACHMENT_LIMIT_EXCEEDED`.

### 7.4 Validation Cases
- **AC-008**: GIVEN file dung lượng > `MINUTES_ATTACHMENT_MAX_BYTES`, WHEN upload, THEN trả 400 `ATTACHMENT_FILE_TOO_LARGE`.
- **AC-009**: GIVEN file định dạng `.exe`, WHEN upload, THEN trả 400 `ATTACHMENT_FILE_TYPE_INVALID`.
- **AC-010**: GIVEN request không kèm file, WHEN upload, THEN trả 400 `ATTACHMENT_FILE_REQUIRED`.

### 7.5 State Transition Cases
- **AC-011**: GIVEN `fileId` đã bị xóa mềm trước đó, WHEN gọi DELETE lại cùng `fileId`, THEN trả 404 `ATTACHMENT_NOT_FOUND`.

### 7.6 Notification / Audit Cases
- **AC-012**: GIVEN upload thành công, THEN có đúng 1 bản ghi `audit_logs` với `action_type = meeting_minutes_attachment_uploaded`.
- **AC-013**: GIVEN xóa thành công, THEN có đúng 1 bản ghi `audit_logs` với `action_type = meeting_minutes_attachment_deleted`.

### 7.7 Concurrency Cases
- **AC-014**: GIVEN `M` còn 1 slot trống trước khi đạt `MINUTES_ATTACHMENT_MAX_COUNT`, WHEN 2 request upload gửi gần như đồng thời, THEN chỉ 1 request thành công (201), request còn lại nhận 409 `ATTACHMENT_LIMIT_EXCEEDED` (đảm bảo bằng lock `pessimistic_write` trên `meeting_minutes`, xem FR-016).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-002, FR-003, FR-021 |
| AC-002 | FR-001 |
| AC-003 | FR-006, FR-018 |
| AC-004 | FR-010 |
| AC-005 | Permission guard (mục 2.2) |
| AC-006 | FR-007 |
| AC-007, AC-014 | FR-008, FR-016 |
| AC-008 | FR-011 |
| AC-009 | FR-012 |
| AC-010 | FR-013 |
| AC-011 | FR-014 |
| AC-012, AC-013 | FR-019 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Xem chi tiết biên bản họp (UC-MKM-03) — feature này chỉ cung cấp dữ liệu, không dựng UI/API tổng hợp chi tiết.
- Đính kèm/gỡ file sau khi biên bản đã `published`/`archived`.
- Cho phép người khác ngoài `preparedBy` (Participant, Business Admin, System Admin) thao tác attachment.
- Đổi tên file, thêm mô tả/caption cho từng attachment, sắp xếp thứ tự hiển thị thủ công.
- File biên bản chính thức export ra PDF/Word (`meeting_minutes.file_id`) — thuộc feature "ban hành biên bản" (issue), không liên quan tới attachment thủ công của Host.
- Virus scanning / deep content inspection cho file upload.

### 8.2 Có thể xem xét ở feature khác
- `feat-view-detail-meeting-minutes` (UC-MKM-03) — sẽ tiêu thụ dữ liệu từ feature này để hiển thị "File đính kèm".
- `feat-update-draft-meeting-minutes` — nếu sau này cho sửa nội dung minutes, có thể cân nhắc gộp UI nhưng API vẫn nên tách riêng.
- `feat-issue-meeting-minutes` — nếu cần cho phép bổ sung tài liệu sau khi ban hành, làm feature riêng có audit chặt hơn.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép upload/xóa attachment khi `meeting_minutes.status ≠ draft` trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT cung cấp endpoint sửa/đổi tên attachment đã upload (chỉ upload mới hoặc xóa).

## Assumptions
Xem mục 1.4.
