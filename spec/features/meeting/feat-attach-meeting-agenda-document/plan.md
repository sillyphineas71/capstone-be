# Implementation Plan: Attach Meeting Agenda Document

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-04 | Khởi tạo plan cho feat-attach-meeting-agenda-document, triển khai ngay trong phiên này (không tách sang phiên sau như dự kiến ban đầu ở `KE_HOACH_BE_AGENDA_ATTACHMENT_2026-08-04.md`) | Toàn bộ file |

## 1. Feature Summary
Bổ sung 2 endpoint dưới `meetings/:meetingId/agendas/:agendaId/attachments` cho phép Host/Organizer upload và xóa (soft-delete) tài liệu đính kèm cho một agenda item, khi meeting đang ở trạng thái `pending_approval`/`scheduled`. Mở rộng `GET /meetings/:meetingId/agendas` hiện có để trả kèm `attachments` cho mỗi item (1 query gộp, không N+1). Dùng lại `MediaFileEntity` (polymorphic `relatedEntityType/relatedEntityId`, `fileType = document`) và `StorageService` hiện có — không migration schema mới, không permission mới.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL + Multer (`FileInterceptor`), theo đúng baseline CLAUDE.md/AGENTS.md. Không dùng Prisma, không migration bảng mới, không migration permission mới.

### 2.2 Existing Codebase Analysis
- `src/modules/meetings/services/meetings.service.ts`: đã có `checkAgendaReadPermission`, `checkAgendaWritePermission`, `validateMeetingStatusForAgendaWrite`, `getAgendas`, `replaceAgendas`, `updateAgendaItem`, `deleteAgendaItem` (dòng ~4428-5378) — tái dùng 3 helper đầu nguyên vẹn, thêm 2 method mới (`addAgendaAttachment`, `removeAgendaAttachment`) ngay sau `deleteAgendaItem`, và sửa `getAgendas` để load kèm attachments.
- `src/modules/meetings/controllers/meetings.controller.ts`: `@Controller()` rỗng, mọi route tự khai path đầy đủ bắt đầu bằng `meetings` (quy ước bắt buộc từ BE-06 2026-07-26, xem comment dòng 122-128) — 2 route mới PHẢI viết đầy đủ `meetings/:meetingId/agendas/:agendaId/attachments...`. Đã có sẵn `FileInterceptor` import (dùng cho `importParticipants`) — tái dùng.
- `src/modules/minutes/services/minutes.service.ts` (`addAttachment`/`listAttachments`/`removeAttachment`, dòng 578-913): **pattern kỹ thuật tham khảo chính**, đã chạy thật trong production (`feat-attach-minutes-document`) — pre-generate UUID, lưu storage trước/insert DB sau trong transaction có lock `pessimistic_write`, best-effort cleanup khi DB fail, validate mimetype+extension.
- `src/modules/recording/entities/media-file.entity.ts`: tái sử dụng nguyên vẹn, dùng `MediaFileType.DOCUMENT` có sẵn (KHÔNG thêm enum value mới như `MINUTES_ATTACHMENT` — khác với minutes vì agenda không cần phân biệt loại riêng).
- `src/modules/storage/storage.service.ts`: `saveFile()`/`deleteFile()` — dùng trực tiếp, `StorageModule` là `@Global()` nên không cần import vào `MeetingsModule`, chỉ cần inject `StorageService` vào constructor `MeetingsService`.
- `ConfigModule` cũng `isGlobal: true` (xem `src/app.module.ts` dòng 76-77) — inject `ConfigService` trực tiếp, không cần sửa `meetings.module.ts`.
- **Khác biệt quan trọng với minutes attachment**: nhóm endpoint agenda hiện tại (`getAgendas`/`replaceAgendas`/`updateAgendaItem`/`deleteAgendaItem`) chỉ dùng `@UseGuards(JwtAuthGuard)`, KHÔNG dùng `PermissionsGuard`/`RequirePermissions` — quyền được check hoàn toàn ở service qua `checkAgendaWritePermission`/`checkAgendaReadPermission` (so sánh trực tiếp `organizerId`/`hostId`). Feature này ĐI THEO đúng convention đó — không thêm permission mới, không thêm `PermissionsGuard` cho 2 route mới (tránh lệch chuẩn với 4 route agenda anh em).

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Lấy user hiện tại: `@CurrentUser() currentUser: { userId: string }` (đúng kiểu đã dùng ở 4 endpoint agenda khác trong cùng controller).
- Exception: `NotFoundException`/`ForbiddenException`/`ConflictException`/`BadRequestException`/`BadGatewayException` với payload `{ success: false, message, error: { code, details } }` (đồng bộ style `MinutesService`, khác với style ngắn gọn `throw new ForbiddenException('AGENDA_WRITE_FORBIDDEN')` mà 4 method agenda cũ đang dùng — dùng payload đầy đủ cho method MỚI để nhất quán với toàn bộ codebase mới hơn, không sửa lại 4 method cũ).
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meetings` bằng `pessimistic_write` khi upload (đếm + insert).
- Upload: `FileInterceptor('file')` + `@UploadedFile()`, KHÔNG set `limits.fileSize` ở Multer (để service tự trả đúng `AGENDA_ATTACHMENT_FILE_TOO_LARGE`).
- Quyết định tổ chức code: 2 method mới nằm trong `MeetingsService` hiện có (không tách service riêng) — vì `getAgendas`/`replaceAgendas`/... đã theo đúng cách này, và logic ngắn.

## 3. Scope Confirmation

### 3.1 In Scope
- 2 endpoint: upload, xóa attachment cho agenda item.
- Mở rộng `GET /meetings/:meetingId/agendas` trả kèm `attachments` (1 query gộp).
- Giới hạn số lượng + kích thước + định dạng file (constants, cấu hình qua `ConfigService`).
- Unit test cho service (happy path + nhánh lỗi chính) và controller (wiring).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — `JwtAuthGuard` + ownership check (organizer/host) ở service |
| SEC-03 (input validation) | PASS — validate file size/mimetype/extension ở service; path traversal đã được `StorageService` xử lý |
| DATA-01 (soft-delete) | PASS — xóa attachment dùng `deleted_at`, không hard-delete |
| ARCH-01 (service boundary) | PASS — chỉ dùng `MediaFileEntity`/`StorageService` qua injection trong cùng process |
| ARCH-02 (async cho >2s) | PASS — upload file ≤ 20MB đồng bộ chấp nhận được |
| ARCH-03 (idempotency) | PASS — xóa lại file đã xóa trả 404 thay vì lỗi 500 |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiConsumes('multipart/form-data')` + `@ApiBody` cho upload |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Không có complexity bất thường, không cần ADR. Điểm cần lưu ý: giới hạn số lượng file tính THEO TỪNG agenda item (không phải theo cả meeting) — khác nhẹ so với minutes (giới hạn theo minutes, tương đương 1-1 với meeting). Không ảnh hưởng độ phức tạp transaction vì vẫn lock ở cấp `meetings`.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 0 permission mới.

### 4.1 Bảng bị ảnh hưởng (cập nhật, không thêm cột)
`meetings` (chỉ đọc + lock, không update cột nào), `meeting_agendas` (chỉ đọc, xác nhận tồn tại), `media_files` (insert/soft-delete các dòng mới, dùng đúng cột đã có).

### 4.2 Bảng được INSERT
`media_files` (N dòng, 1/lần upload), `audit_logs` (1 dòng/thao tác upload hoặc xóa).

### 4.3 Seed / Migration
Không có. Không thêm permission mới (xem 2.2 — nhóm endpoint agenda không dùng `PermissionsGuard`).

## 5. API / Contract Plan

### 5.1 Endpoints
- `POST /api/v1/meetings/:meetingId/agendas/:agendaId/attachments` (multipart/form-data, field `file`)
- `DELETE /api/v1/meetings/:meetingId/agendas/:agendaId/attachments/:fileId`
- `GET /api/v1/meetings/:meetingId/agendas` (SỬA — endpoint có sẵn, thêm field `attachments` vào mỗi item)

### 5.2 Request / 5.3 Success Response / 5.4 Error Responses
Xem spec.md mục 5, 6.

## 6. Authorization Plan

### 6.1 Permission Design
Không có permission mới. Dùng lại ownership check hiện có (`checkAgendaWritePermission`/`checkAgendaReadPermission`).

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. Service load `meetings` (có lock khi upload), gọi `checkAgendaWritePermission`(upload/xóa)/`checkAgendaReadPermission`(đọc trong GET agendas).
3. Service load `meeting_agendas` theo `agendaId` + `meetingId`, 404 nếu không khớp.

### 6.3 Error
Không phải organizer/host → 403 `AGENDA_WRITE_FORBIDDEN`. Không thỏa read permission → 403 `AGENDA_READ_FORBIDDEN`.

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Upload
```text
1. (Ngoài transaction) Validate file: required -> 400 AGENDA_ATTACHMENT_FILE_REQUIRED
2. size <= MAX_BYTES -> 400 AGENDA_ATTACHMENT_FILE_TOO_LARGE
3. mimetype thuộc allowlist -> 400 AGENDA_ATTACHMENT_FILE_TYPE_INVALID
4. extension khớp mimetype -> 400 AGENDA_ATTACHMENT_FILE_TYPE_INVALID
5. Load meeting (không lock) + checkAgendaWritePermission + validateMeetingStatusForAgendaWrite
   -> load agenda item theo (agendaId, meetingId) -> 404 nếu không có
6. storageService.saveFile({ buffer, originalName, folder: 'agenda-attachments' })
7. BEGIN TRANSACTION
8. SELECT meetings FOR UPDATE WHERE id = :meetingId (lock, re-validate status/ownership tránh race)
9. SELECT meeting_agendas WHERE id = :agendaId AND meeting_id = :meetingId (re-validate tồn tại)
10. COUNT media_files WHERE relatedEntityType='meeting_agenda' AND relatedEntityId=:agendaId AND deletedAt IS NULL
    -> nếu >= MAX_COUNT -> 409 AGENDA_ATTACHMENT_LIMIT_EXCEEDED
11. INSERT media_files (fileType=document, relatedEntityType='meeting_agenda', relatedEntityId=agendaId,
    meetingId, uploadedBy, storageProvider, storageKey, fileUrl, fileSizeBytes, mimeType, fileName)
12. INSERT audit_logs (action_type=meeting_agenda_attachment_uploaded)
COMMIT
-- Nếu bước 8-12 throw: best-effort storageService.deleteFile(storageKey) (catch, log warn, không raise)
```
Bước 6 (lưu file vật lý) xảy ra SAU khi validate input (1-4) nhưng TRƯỚC transaction DB — nếu bước 8-12 fail thì cleanup storage ở catch, đúng giới hạn kỹ thuật TypeORM (không rollback được filesystem/S3).

### 7.2 Transaction Boundary — Delete
```text
1. BEGIN TRANSACTION
2. SELECT meetings FOR UPDATE WHERE id = :meetingId -> 404 MEETING_NOT_FOUND nếu không có/đã xóa
3. checkAgendaWritePermission -> 403 AGENDA_WRITE_FORBIDDEN
4. validateMeetingStatusForAgendaWrite -> 409 AGENDA_MEETING_STATUS_BLOCKED
5. SELECT meeting_agendas WHERE id=:agendaId AND meeting_id=:meetingId -> 404 AGENDA_ITEM_NOT_FOUND
6. SELECT media_files WHERE id=:fileId AND relatedEntityType='meeting_agenda' AND relatedEntityId=:agendaId
   AND deletedAt IS NULL -> không có -> 404 AGENDA_ATTACHMENT_NOT_FOUND
7. UPDATE media_files SET deleted_at = now() WHERE id=:fileId
8. INSERT audit_logs (action_type=meeting_agenda_attachment_deleted)
COMMIT
-- Sau commit: best-effort storageService.deleteFile(storageKey) (catch, log warn)
```

### 7.3 GET agendas — mở rộng (không transaction)
```text
1. checkAgendaReadPermission(meetingId, userId) (như hiện tại)
2. Query meeting_agendas WHERE meetingId (như hiện tại)
3. MỚI: agendaIds = agendas.map(a => a.id)
4. MỚI: attachmentsByAgendaId = SELECT media_files WHERE relatedEntityType='meeting_agenda'
   AND relatedEntityId IN (agendaIds) AND deletedAt IS NULL ORDER BY uploadedAt DESC
   -> group by relatedEntityId trong bộ nhớ (1 query, không N+1)
5. Map mỗi AgendaItemResponseDto kèm attachments = attachmentsByAgendaId.get(item.id) ?? []
```

### 7.4 Key Business Rules Implemented
Chỉ organizer/host thao tác được, chỉ khi meeting `pending_approval`/`scheduled`, giới hạn số lượng theo TỪNG agenda item + kích thước + định dạng file (spec.md mục 1.5, dùng default cho tới khi Product Owner xác nhận).

## 8. Validation Plan

### 8.1 Input Validation
- `meetingId`, `agendaId`, `fileId` — `ParseUUIDPipe` ở controller.
- File — validate trong service (Multer file, không phải DTO thường): required, size, mimetype/extension allowlist.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1/7.2: meeting tồn tại → ownership → status → agenda item tồn tại → file hợp lệ → giới hạn số lượng (chỉ upload).

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Meeting không tồn tại/đã xóa | `NotFoundException` | `MEETING_NOT_FOUND` |
| Không phải organizer/host | `ForbiddenException` | `AGENDA_WRITE_FORBIDDEN` |
| Meeting status không hợp lệ | `ConflictException` | `AGENDA_MEETING_STATUS_BLOCKED` |
| Agenda item không tồn tại/không thuộc meeting | `NotFoundException` | `AGENDA_ITEM_NOT_FOUND` |
| Thiếu file | `BadRequestException` | `AGENDA_ATTACHMENT_FILE_REQUIRED` |
| File quá lớn | `BadRequestException` | `AGENDA_ATTACHMENT_FILE_TOO_LARGE` |
| Định dạng không hợp lệ | `BadRequestException` | `AGENDA_ATTACHMENT_FILE_TYPE_INVALID` |
| Vượt số lượng | `ConflictException` | `AGENDA_ATTACHMENT_LIMIT_EXCEEDED` |
| File không tồn tại (khi xóa) | `NotFoundException` | `AGENDA_ATTACHMENT_NOT_FOUND` |
| Lưu storage thất bại | `BadGatewayException` | `AGENDA_ATTACHMENT_STORAGE_FAILED` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction DB tự động rollback. Lỗi storage (ngoài transaction DB) xử lý bù trừ thủ công theo 7.1/7.2.

## 10. Testing Strategy

### 10.1 Unit Tests
`meetings.service.spec.ts` (bổ sung case mới, hoặc file test riêng `tests/agenda-attachment.service.spec.ts` theo đúng convention thư mục `tests/` đã dùng cho `update-agenda-item`/`delete-agenda-item`): upload happy path, xóa happy path, not-owner (cả 2 action), status không hợp lệ (cả 2 action), agenda item không tồn tại, file thiếu, file quá lớn, file sai định dạng, vượt giới hạn số lượng, xóa file không tồn tại/đã xóa, storage lỗi → cleanup không raise thêm lỗi, `getAgendas` trả đúng `attachments` gộp (rỗng + có dữ liệu), không N+1.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test qua DB thật: tạo agenda + upload thật (multipart) qua supertest + assert file tồn tại trên local storage test dir + assert DB.

## 11. Implementation Phases

### Phase 1: Preparation
Constants (`AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT`, `AGENDA_ATTACHMENT_MAX_COUNT_DEFAULT`, allowlist mimetype/extension), DTO (`AgendaAttachmentDto`, `AgendaAttachmentUploadResponseDto`, `DeleteAgendaAttachmentResponseDto`), mở rộng `AgendaItemResponseDto` thêm `attachments`.

### Phase 2: Service Logic
`MeetingsService.addAgendaAttachment` / `removeAgendaAttachment`, sửa `getAgendas` load kèm attachments gộp.

### Phase 3: Controller Endpoints
Thêm 2 route vào `MeetingsController` (cùng khối "Agenda endpoints (UC-MM-09)", đầy đủ path `meetings/...`).

### Phase 4: Tests
Unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Race condition vượt `AGENDA_ATTACHMENT_MAX_COUNT` khi nhiều upload đồng thời cho cùng agenda item | Lock `meetings` row (`FOR UPDATE`) trước khi đếm + insert, giống pattern `MinutesService.addAttachment` |
| Orphan file trên storage khi DB transaction fail | Best-effort cleanup (`storageService.deleteFile`) trong catch, không raise lỗi thêm |
| Số liệu giới hạn (max count/size) chưa được Product Owner xác nhận | Đánh dấu [NEEDS CLARIFICATION] trong spec.md, dùng giá trị mặc định hợp lý qua `ConfigService` |
| `checkAgendaWritePermission` hiện tại không có bypass cho Admin (gap đã biết của UC-MM-09 gốc) | Giữ nguyên hành vi hiện tại, không mở rộng phạm vi sửa trong feature này — ghi rõ ở spec.md mục 1.5 |
| `MeetingsService` đã rất lớn (>5300 dòng), thêm method có thể khó bảo trì | Chấp nhận ở feature này (2 method ngắn, đặt liền sau `deleteAgendaItem` để dễ tìm) — cân nhắc tách `MeetingAgendaAttachmentService` riêng nếu feature sau tiếp tục mở rộng |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md` (theo Speckit template của repo — `.specify/templates/`). Không tạo `research.md`/`data-model.md`/`contracts/*.md`/`quickstart.md`/`checklists/requirements.md` — feature nhỏ, tái dùng pattern đã kiểm chứng, không cần các tài liệu phụ đó (đồng nhất quyết định đã áp dụng ở `feat-attach-minutes-document`).
