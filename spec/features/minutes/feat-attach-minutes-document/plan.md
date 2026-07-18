# Implementation Plan: Attach Minutes Document

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-attach-minutes-document | Toàn bộ file |
| 2026-07-17 | Mở rộng quyền đọc (List) theo UC-139/140, thay `loadMinutesForOwnerCheck` bằng `loadMinutesForReadCheck` (dùng chung `canAccessMinutes` với `feat-view-meeting-minutes-detail`); ghi chú gap-fix role `INTERNAL_USER` → `EMPLOYEE`. Xem `feat-view-minutes-attachment-detail` cho phần UC-140. | Mục 6.2, 4.3 |

## 1. Feature Summary
Bổ sung 3 endpoint dưới `meeting-minutes/:minutesId/attachments` cho phép Host (`preparedBy`) upload, xem danh sách, và xóa (soft-delete) tài liệu đính kèm cho biên bản họp đang ở trạng thái `draft`. Dùng lại `MediaFileEntity` (polymorphic `relatedEntityType/relatedEntityId`, giống pattern `face_profile` trong avatar submission) và `StorageService` hiện có — không migration schema mới.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL + Multer (`@nestjs/platform-express` `FileInterceptor`), theo đúng baseline CLAUDE.md. Không dùng Prisma, không migration bảng mới.

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: chứa `createDraft` + `findMinutesList`; sẽ thêm 3 method mới (`addAttachment`, `listAttachments`, `removeAttachment`) — cân nhắc tách thành service riêng nếu file trở nên quá dài (xem 2.3).
- `src/modules/minutes/controllers/minutes-list.controller.ts`: đã dùng `@Controller('meeting-minutes')` — endpoint attachment nên nằm cùng controller hoặc controller con cùng prefix để nhất quán route `meeting-minutes/:minutesId/...`.
- `src/modules/recording/entities/media-file.entity.ts`: entity tái sử dụng nguyên vẹn, đã có sẵn `MediaFileType.MINUTES_ATTACHMENT` (dòng 18) — không cần sửa entity.
- `src/modules/accounts/services/avatar-submission.service.ts`: **pattern kỹ thuật tham khảo chính** — pre-generate UUID, upload storage trước/insert DB sau trong transaction, best-effort cleanup khi DB fail, xử lý lỗi race condition qua unique index (ở đây thay bằng lock + đếm số lượng).
- `src/modules/accounts/controllers/avatar.controller.ts`: pattern controller multipart (`FileInterceptor('file')`, `@ApiConsumes('multipart/form-data')`, `@UploadedFile()`).
- `src/modules/storage/storage.service.ts`: `saveFile({ buffer, originalName, folder })` / `deleteFile(storageKey)` — dùng trực tiếp, không sửa.
- `src/modules/recording/services/media-files.service.ts`: có method tương tự `detail`/`list` nhưng scope theo `meetingId`, KHÔNG theo `relatedEntityId` — **không tái sử dụng trực tiếp**, service mới của feature này tự query theo `relatedEntityType/relatedEntityId` (khác điều kiện lọc).
- `src/database/seeds/20260702000001-SeedMeetingMinutesCreatePermission.ts` + `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`: 2 pattern seed permission khác nhau đã tồn tại song song (1 ở `seeds/`, 1 ở `migrations/`) — ghi chú rủi ro ở mục 12; feature này dùng **migration** (theo comment trong `SeedMeetingMinutesReadPermission.ts`: "seed-runner cho thư mục seeds/ chưa được wire vào đâu — migration là cơ chế seed duy nhất thực sự chạy được").

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }` (kèm `meta` cho list).
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.attachment.<action>')`.
- Lấy user hiện tại: `@CurrentUser() user: { userId: string }`.
- Exception: `NotFoundException`/`ForbiddenException`/`ConflictException`/`BadRequestException` với payload `{ success: false, message, error: { code, details } }`.
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meeting_minutes` bằng `pessimistic_write` (giống `createDraft`).
- Upload: `FileInterceptor('file')` + `@UploadedFile()`, KHÔNG set `limits.fileSize` ở Multer (để service tự trả đúng `ATTACHMENT_FILE_TOO_LARGE`, theo đúng ghi chú trong `avatar.controller.ts` dòng 85-86).
- Quyết định tổ chức code: đặt 3 method mới trong `MinutesService` hiện có (không tách service riêng) — vì logic ngắn. Ban đầu tái dùng chung `loadMinutesForOwnerCheck` cho cả 3; từ 2026-07-17, `listAttachments` đổi sang `loadMinutesForReadCheck` (method mới, riêng cho quyền đọc), `addAttachment`/`removeAttachment` vẫn dùng `loadMinutesForOwnerCheck`. Nếu sau này thêm nhiều thao tác khác cho attachment, cân nhắc tách `MinutesAttachmentService` trong feature kế tiếp.

## 3. Scope Confirmation

### 3.1 In Scope
- 3 endpoint: upload, list, delete attachment.
- Guard: Host/`preparedBy`-only, minutes status `draft`-only, giới hạn số lượng + kích thước + định dạng file.
- 3 permission mới (seed qua migration).
- Unit test cho service (happy path + các nhánh lỗi chính) và controller (wiring/guard).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — không xử lý secret |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership check (`preparedBy`) |
| SEC-03 (input validation) | PASS — validate file size/mimetype ở service; path traversal đã được `StorageService` xử lý |
| DATA-01 (soft-delete) | PASS — xóa attachment dùng `deleted_at`, không hard-delete |
| ARCH-01 (service boundary) | PASS — chỉ dùng `MediaFileEntity`/`StorageService` qua injection trong cùng process, không gọi chéo service module khác |
| ARCH-02 (async cho >2s) | PASS — upload file ≤ 20MB đồng bộ chấp nhận được, không cần `background_jobs` |
| ARCH-03 (idempotency) | PASS — xóa lại file đã xóa trả 404 thay vì lỗi 500 |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — `@ApiConsumes('multipart/form-data')` + `@ApiBody` cho upload |
| ENG-03 (error không lộ stack trace) | PASS — dùng NestJS exception filter chung |

### 3.4 Complexity Tracking
Không có complexity bất thường. Không cần ADR. Điểm cần lưu ý duy nhất: 2 pattern seed permission (`seeds/` vs `migrations/`) đang tồn tại song song trong repo — feature này đi theo `migrations/` (đã xác nhận là cơ chế chạy thật), không tạo thêm rối loạn bằng cách dùng `seeds/`.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 3 permission mới (seed qua migration).

### 4.1 Bảng bị ảnh hưởng (cập nhật, không thêm cột)
`meeting_minutes` (chỉ đọc + lock, không update cột nào), `media_files` (insert/soft-delete các dòng mới, dùng đúng cột đã có).

### 4.2 Bảng được INSERT
`media_files` (N dòng, 1/lần upload), `audit_logs` (1 dòng/thao tác upload hoặc xóa), `permissions` + `role_permissions` (qua migration, không phải runtime).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesAttachmentPermissions` (copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`), seed 3 permission: `meeting.minutes.attachment.create`, `meeting.minutes.attachment.read`, `meeting.minutes.attachment.delete`, module_code=`minutes`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

**Gap fix (2026-07-17)**: role `INTERNAL_USER` không tồn tại trong DB thật (4 role thật: `BUSINESS_ADMIN`, `EMPLOYEE`, `MANAGER`, `SYSTEM_ADMIN`) — migration trên chưa từng thực sự cấp quyền cho Employee. Vá bằng migration bổ sung `20260717000001-FixMinutesAttachmentEmployeeRole.ts` (cấp lại 4 permission liên quan minutes cho `EMPLOYEE`, theo đúng tiền lệ `20260711000001-SeedRecordingUploadTrackEmployeeRole.ts`).

## 5. API / Contract Plan

### 5.1 Endpoints
- `POST /api/v1/meeting-minutes/:minutesId/attachments` (multipart/form-data, field `file`)
- `GET /api/v1/meeting-minutes/:minutesId/attachments`
- `DELETE /api/v1/meeting-minutes/:minutesId/attachments/:fileId`

### 5.2 Request
Xem spec.md mục 5.2.

### 5.3 Success Response
`201 Created` (upload), `200 OK` (list, delete) — xem spec.md mục 5.3.

### 5.4 Error Responses
`400 ATTACHMENT_FILE_REQUIRED / ATTACHMENT_FILE_TOO_LARGE / ATTACHMENT_FILE_TYPE_INVALID`, `401 Unauthorized`, `403 NOT_MINUTES_OWNER / FORBIDDEN`, `404 MINUTES_NOT_FOUND / ATTACHMENT_NOT_FOUND`, `409 MINUTES_NOT_DRAFT / ATTACHMENT_LIMIT_EXCEEDED`, `502 ATTACHMENT_STORAGE_FAILED`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.attachment.create|read|delete`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions(...)` kiểm tra permission cấp role, riêng theo từng endpoint.
3. Service kiểm tra thêm:
   - **Upload/Delete**: resource ownership `meetingMinutes.preparedBy === authUser.userId` (`loadMinutesForOwnerCheck`) — không đổi.
   - **List (cập nhật 2026-07-17)**: trước đây dùng chung `loadMinutesForOwnerCheck` (preparedBy-only) "vì chưa có UC xem chi tiết chính thức để định nghĩa quyền xem rộng hơn cho Participant/Host khi published" — nay UC đó đã có (UC-139/UC-140, Feature Table chính thức), nên đổi sang `loadMinutesForReadCheck` (method mới, dùng chung `canAccessMinutes` với `findMinutesDetail` của `feat-view-meeting-minutes-detail`): biên bản `draft` → chỉ `preparedBy`; `published`/`archived` → Host của cuộc họp hoặc bất kỳ Participant nào; `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → luôn qua.

### 6.3 Error
Thiếu permission → 403 `FORBIDDEN` (guard). Có permission nhưng không phải `preparedBy` → 403 `NOT_MINUTES_OWNER` (service).

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Upload
```text
1. SELECT meeting_minutes FOR UPDATE WHERE id = :minutesId (lock)
2. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
3. Validate: preparedBy === authUser.userId -> 403 NOT_MINUTES_OWNER
4. Validate: status === draft -> 409 MINUTES_NOT_DRAFT
5. Validate: file tồn tại trong request -> 400 ATTACHMENT_FILE_REQUIRED
6. Validate: file.size <= MAX_BYTES -> 400 ATTACHMENT_FILE_TOO_LARGE
7. Validate: mimetype/extension thuộc allowlist -> 400 ATTACHMENT_FILE_TYPE_INVALID
8. COUNT media_files WHERE relatedEntityType='meeting_minutes' AND relatedEntityId=:minutesId AND deletedAt IS NULL (trong transaction, sau khi đã lock minutes)
   -> nếu >= MAX_COUNT -> 409 ATTACHMENT_LIMIT_EXCEEDED
9. (NGOÀI transaction DB, nhưng trước khi commit logic) storageService.saveFile({ buffer, originalName, folder: 'minutes-attachments' })
10. INSERT media_files (fileType=minutes_attachment, relatedEntityType='meeting_minutes', relatedEntityId=minutesId, meetingId=minutes.meetingId, uploadedBy=authUser.userId, storageProvider, storageKey, fileUrl, fileSizeBytes, mimeType, fileName)
11. INSERT audit_logs (action_type=meeting_minutes_attachment_uploaded)
COMMIT
-- Nếu bước 10/11 throw: best-effort storageService.deleteFile(storageKey) (catch, log warn, không raise)
```
Lưu ý thứ tự: bước 9 (lưu file vật lý) xảy ra SAU khi mọi validate nghiệp vụ (1-8) đã pass trong transaction, để tránh lưu file rồi mới phát hiện lỗi nghiệp vụ (giảm rác storage). Bước 10-11 nằm trong cùng transaction DB; bước 9 nằm ngoài transaction DB theo đúng giới hạn kỹ thuật của TypeORM (không rollback được filesystem/S3), xử lý bù trừ bằng cleanup ở catch — nhất quán với `AvatarSubmissionService`.

### 7.2 Transaction Boundary — Delete
```text
1. SELECT meeting_minutes FOR UPDATE WHERE id = :minutesId
2. Validate: tồn tại -> 404 MINUTES_NOT_FOUND
3. Validate: preparedBy === authUser.userId -> 403 NOT_MINUTES_OWNER
4. Validate: status === draft -> 409 MINUTES_NOT_DRAFT
5. SELECT media_files WHERE id=:fileId AND relatedEntityType='meeting_minutes' AND relatedEntityId=:minutesId AND deletedAt IS NULL
   -> không có -> 404 ATTACHMENT_NOT_FOUND
6. UPDATE media_files SET deleted_at = now() WHERE id=:fileId (soft delete qua repo.softDelete)
7. INSERT audit_logs (action_type=meeting_minutes_attachment_deleted)
COMMIT
-- Sau commit: best-effort storageService.deleteFile(storageKey) (catch, log warn — file vật lý xóa ngoài transaction, không chặn response)
```

### 7.3 List (không cần transaction, cập nhật 2026-07-17)
```text
1. SELECT meeting_minutes JOIN meeting WHERE id=:minutesId AND deletedAt IS NULL -> không có -> 404 MINUTES_NOT_FOUND
2. Nếu role effective KHÔNG có SYSTEM_ADMIN/BUSINESS_ADMIN:
   - Đếm participant của meeting (userId=authUser.userId) -> isParticipant
   - canAccessMinutes(minutes, meeting, userId, isAdmin=false, isParticipant):
     - status=draft -> chỉ true nếu preparedBy === userId
     - status=published/archived -> true nếu hostId === userId HOẶC isParticipant
   - false -> 403 MEETING_MINUTES_ACCESS_DENIED (loadMinutesForReadCheck)
3. SELECT media_files WHERE relatedEntityType='meeting_minutes' AND relatedEntityId=:minutesId AND deletedAt IS NULL ORDER BY uploadedAt DESC
4. Trả về list + meta { total, maxCount }
```

### 7.4 Key Business Rules Implemented
Chỉ `preparedBy` thao tác được, chỉ khi `status = draft`, giới hạn số lượng + kích thước + định dạng file (spec.md mục 1.5, cần Product Owner xác nhận số liệu cụ thể trước khi code — xem Risk mục 12).

## 8. Validation Plan

### 8.1 Input Validation
- `minutesId`, `fileId` — `ParseUUIDPipe` ở controller.
- File — validate trong service (không dùng class-validator vì là `Buffer`/Multer file, không phải DTO thường): required, size, mimetype/extension allowlist.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1/7.2: tồn tại → ownership → status draft → file hợp lệ → giới hạn số lượng (chỉ upload).

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Upload/Delete: không phải `preparedBy` | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| List (2026-07-17): không thỏa `canAccessMinutes` | `ForbiddenException` | `MEETING_MINUTES_ACCESS_DENIED` |
| Status không phải draft | `ConflictException` | `MINUTES_NOT_DRAFT` |
| Thiếu file | `BadRequestException` | `ATTACHMENT_FILE_REQUIRED` |
| File quá lớn | `BadRequestException` | `ATTACHMENT_FILE_TOO_LARGE` |
| Định dạng không hợp lệ | `BadRequestException` | `ATTACHMENT_FILE_TYPE_INVALID` |
| Vượt số lượng | `ConflictException` | `ATTACHMENT_LIMIT_EXCEEDED` |
| File không tồn tại (khi xóa) | `NotFoundException` | `ATTACHMENT_NOT_FOUND` |
| Lưu storage thất bại | `BadGatewayException` | `ATTACHMENT_STORAGE_FAILED` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction DB tự động rollback (TypeORM transaction callback). Lỗi storage (ngoài transaction DB) xử lý bù trừ thủ công theo 7.1/7.2.

### 9.3 Notification Error (Non-blocking)
Không áp dụng (không có notification trong feature này).

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới): upload happy path, list happy path, delete happy path, not-owner (cả 3 action), status không phải draft (cả 3 action), file thiếu, file quá lớn, file sai định dạng, vượt giới hạn số lượng, xóa file không tồn tại/đã xóa, storage lỗi → cleanup không raise thêm lỗi.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test qua DB thật: tạo minutes draft + upload thật (multipart) qua supertest + assert file tồn tại trên local storage test dir + assert DB.

### 10.3 Permission Seed Test
Không bắt buộc unit test riêng cho migration seed (theo pattern hiện có, các seed/migration permission khác cũng không có test).

## 11. Implementation Phases

### Phase 1: Preparation
DTO response (`MinutesAttachmentResponseDto`), constants (`MINUTES_ATTACHMENT_MAX_BYTES`, `MINUTES_ATTACHMENT_MAX_COUNT`, allowlist mimetype/extension).

### Phase 2: Service Logic
`MinutesService.addAttachment` / `listAttachments` / `removeAttachment`.

### Phase 3: Controller Endpoints
Thêm 3 route vào `MeetingMinutesListController` (hoặc controller mới cùng prefix `meeting-minutes` nếu tách rõ theo concern — quyết định cụ thể ở lúc code, không ảnh hưởng spec).

### Phase 4: Seed & Tests
Migration seed 3 permission mới, unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Race condition vượt `MINUTES_ATTACHMENT_MAX_COUNT` khi nhiều upload đồng thời | Lock `meeting_minutes` row (`FOR UPDATE`) trước khi đếm + insert, giống pattern `createDraft` |
| Orphan file trên storage khi DB transaction fail | Best-effort cleanup (`storageService.deleteFile`) trong catch, không raise lỗi thêm (giống `AvatarSubmissionService.cleanupCloudinary`) |
| Số liệu giới hạn (max count/size) chưa được Product Owner xác nhận | Đánh dấu rõ [NEEDS CLARIFICATION] trong spec.md, dùng giá trị mặc định hợp lý qua `ConfigService`, dễ đổi qua env mà không cần sửa code |
| 2 pattern seed song song (`seeds/` vs `migrations/`) gây nhầm lẫn cho người code sau | Đi theo `migrations/` (đã xác nhận chạy thật), ghi rõ lý do trong plan.md mục 2.2 |
| `MinutesService` phình to khi cộng dồn nhiều method qua các feature | Chấp nhận ở feature này (3 method ngắn); cân nhắc tách service khi feature tiếp theo làm tăng thêm độ phức tạp |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`. (Theo yêu cầu người dùng — KHÔNG tạo `research.md`, `data-model.md`, `contracts/*.md`, `quickstart.md`, `checklists/requirements.md` ở giai đoạn này; implementation thực tế sẽ do người dùng tự làm sau.)
