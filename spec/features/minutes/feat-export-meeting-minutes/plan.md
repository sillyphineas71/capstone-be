# Implementation Plan: Export Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo plan cho feat-export-meeting-minutes (UC-147) | Toàn bộ file |

## 1. Feature Summary
Thêm 1 endpoint `POST /api/v1/meeting-minutes/:id/exports` cho phép `preparedBy`, `meeting.hostId` hiện tại, hoặc Business Admin/System Admin tạo job bất đồng bộ xuất 1 biên bản đang `published` ra file PDF hoặc Word (.docx), lưu qua `StorageService` (S3/MinIO), tạo `MediaFileEntity` (`fileType=EXPORT`), và (nếu là export mặc định) cập nhật `meeting_minutes.file_id`. Toàn bộ hạ tầng async (queue `minutes-export`, `BackgroundJobType.EXPORT_MINUTES`, `MediaFileType.EXPORT`) đã được provision sẵn trong codebase — feature này chỉ cần viết controller/DTO/service/worker/renderer, không cần đăng ký queue mới.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL + BullMQ (`@nestjs/bullmq`). Thêm 1 dependency mới: `docx` (npm) cho render Word. 1 migration mới (seed permission `meeting.minutes.export`) — không migration schema (không bảng/cột mới).

### 2.2 Existing Codebase Analysis — hạ tầng tái sử dụng trực tiếp

| Thành phần | Vị trí | Trạng thái |
| :--- | :--- | :--- |
| `meeting_minutes.file_id` | `meeting-minutes.entity.ts:96-97` | Cột có sẵn, `NULL` — chưa từng dùng |
| `MediaFileType.EXPORT` | `media-file.entity.ts` | Enum value có sẵn — chưa từng dùng |
| `BackgroundJobType.EXPORT_MINUTES` | `background-job.entity.ts:17` | Enum value có sẵn — chưa từng dùng |
| Queue `minutes-export` | `queue.module.ts:98-101`, `queue.service.ts:51,97-98` | **Đã đăng ký sẵn** (`QUEUE_MINUTES_EXPORT_NAME` injected vào `QueueService.minutesExportQueue`), chưa có `@Processor` nào consume |
| `StorageService.saveFile()` / `getSignedStorageUrl()` | `src/modules/storage/storage.service.ts` | Đã hoạt động, dùng bởi `reports` worker và `feat-view-minutes-attachment-detail` |
| `pdfkit` | `package.json` | Đã cài, dùng ở `reports/renderers/*.ts` |
| `docx` (npm) | — | **CHƯA cài** — cần thêm vào `package.json` |
| `BackgroundJobsService` (`createQueuedJob`/`markRunning`/`markCompleted`/`markFailed`) | `administration/services/background-jobs.service.ts` | Đã hoạt động, dùng nguyên |
| `QueueService.addJob(queueName, jobName, data)` | `queue/queue.service.ts:124` | Đã hoạt động, gọi với `queueName='minutes-export'` |
| Pattern worker mẫu | `reports/processors/meeting-activity-report-worker.processor.ts` | Copy cấu trúc 7 bước (markRunning → render → saveFile → tạo MediaFileEntity → markCompleted → update output_file_id → catch→markFailed) |
| Ownership-check pattern (`preparedBy OR meeting.hostId OR Admin`) | `minutes.service.ts` (method `issueMinutes`, xem `feat-issue-meeting-minutes`) | Tái dùng logic tương tự |
| Migration seed permission mẫu | `20260702030000-SeedMeetingMinutesIssuePermission.ts` | Copy pattern cho `meeting.minutes.export` |

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`, `HttpCode(202)` cho response tạo job.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.export')`.
- Validate đồng bộ (ownership + status) TRƯỚC khi enqueue — không enqueue rồi mới validate trong worker (FR-018).
- Worker: 1 `@Processor('minutes-export')` duy nhất, dispatch theo `job.name` nếu sau này có thêm loại job khác trong cùng queue (mirror comment trong `MeetingActivityReportWorkerProcessor.process()`).
- Worker bọc toàn bộ logic trong try/catch, KHÔNG throw tiếp (ARCH-02, tránh crash worker — pattern đã dùng ở `reports`).

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `POST /api/v1/meeting-minutes/:id/exports`.
- Ownership rule (`preparedBy` OR `meeting.hostId`) + Admin bypass.
- Điều kiện `meeting_minutes.status = published`.
- Render PDF (`pdfkit`) và Word (`docx`, dependency mới).
- Worker `@Processor('minutes-export')` xử lý job, lưu file qua `StorageService`, tạo `MediaFileEntity`.
- Cập nhật `meeting_minutes.file_id` cho export mặc định (FR-006).
- 1 permission mới (seed qua migration).
- Unit test cho service (tạo job) + worker (render/save) + controller.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership-or-admin check |
| SEC-03 (input validation) | PASS — DTO validate `format` enum, path param UUID |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity/service đã có qua injection |
| ARCH-02 (async cho >2s) | PASS — render/upload chạy trong worker, API tạo job trả 202 ngay |
| ARCH-03 (idempotency) | **GAP đã biết, chấp nhận** — nhất quán tiền lệ `reports` module (xem spec.md mục 1.5/8.1), không phải regression riêng |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS — worker catch lỗi, chỉ lưu `errorMessage` rút gọn |

### 3.4 Complexity Tracking
Độ phức tạp cao hơn `feat-issue-meeting-minutes` (thêm: 1 dependency mới `docx`, 1 worker/processor mới, 2 renderer mới, tích hợp `StorageService`/`MediaFileEntity`/BullMQ) nhưng KHÔNG cần thiết kế mới — toàn bộ pattern đã có sẵn ở `reports` module để copy/mirror. Không cần ADR riêng vì không có quyết định kiến trúc mới (chỉ áp dụng lại pattern đã duyệt).

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 0 giá trị enum mới (tất cả đã có sẵn), 1 permission mới (migration), 1 npm dependency mới (`docx`).

### 4.1 Bảng bị ảnh hưởng
`meeting_minutes` (đọc nội dung; UPDATE có điều kiện `file_id` — chỉ export mặc định), `meetings` (chỉ đọc `host_id`, không ghi), `transcripts` (chỉ đọc, có điều kiện `includeTranscript`), `background_jobs` (INSERT + UPDATE trạng thái), `media_files` (INSERT), `audit_logs` (INSERT khi job thành công).

### 4.2 Seed / Migration
1 migration mới: `SeedMeetingMinutesExportPermission`, copy pattern từ `20260702030000-SeedMeetingMinutesIssuePermission.ts`, seed permission `meeting.minutes.export`, module_code=`minutes`, action_code=`minutes.export`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

## 5. API / Contract Plan

### 5.1 Endpoint
- `POST /api/v1/meeting-minutes/:id/exports` — **lưu ý**: dùng đúng prefix `meeting-minutes` (route `:id` = minutesId trực tiếp) theo convention đã thiết lập bởi `MeetingMinutesListController` (`/meeting-minutes/:id/issue`, `/meeting-minutes/:id/link-resources`), KHÁC với path `/meetings/{meetingId}/minutes/exports` ghi trong API Contract gốc — sai khác có chủ đích, nhất quán toàn bộ endpoint khác của module `minutes` đã build trước đó.

### 5.2 Request / Response
Xem spec.md mục 5.2/5.3.

### 5.3 Success Response
`202 Accepted`.

### 5.4 Error Responses
`400` (UUID/format không hợp lệ), `401 Unauthorized`, `403 FORBIDDEN / NOT_MINUTES_OWNER`, `404 MINUTES_NOT_FOUND`, `409 MINUTES_NOT_PUBLISHED`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.export`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.export')`.
3. Service tính `isAdmin` qua `AuthzReadRepository`, hoặc `isOwner = minutes.preparedBy === userId || meeting.hostId === userId`.
4. Cho phép tạo job NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MINUTES_OWNER`.

## 7. Business Logic Plan

### 7.1 Request Flow — Create Export Job (đồng bộ)
```text
1. Validate DTO: format ∈ {pdf, docx} bắt buộc; includeTranscript/includeActionItems optional boolean
2. SELECT meeting_minutes WHERE id = :minutesId (KHÔNG cần pessimistic lock — export chỉ đọc, không sửa nội dung minutes)
3. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
4. SELECT meetings WHERE id = minutes.meetingId (đọc hostId, không lock)
5. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
   isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN
   isOwner = minutes.preparedBy === authUser.userId OR meeting?.hostId === authUser.userId
   IF NOT (isAdmin OR isOwner) -> 403 NOT_MINUTES_OWNER
6. Validate: minutes.status === 'published' -> 409 MINUTES_NOT_PUBLISHED
7. backgroundJob = backgroundJobsService.createQueuedJob({
     jobType: BackgroundJobType.EXPORT_MINUTES,
     requestedBy: authUser.userId,
     relatedEntityType: 'meeting_minutes',
     relatedEntityId: minutesId,
     inputJson: { minutesId, format: dto.format, includeTranscript, includeActionItems },
   })
8. queueService.addJob('minutes-export', 'export:meeting-minutes', {
     backgroundJobId: backgroundJob.id, minutesId, format: dto.format,
     includeTranscript, includeActionItems, requestedByUserId: authUser.userId,
   })
9. Trả 202 { jobId: backgroundJob.id, status: 'queued', minutesId, format, estimatedCompletion: null }
```

### 7.2 Worker Flow — Process Export Job (bất đồng bộ, trong `MinutesExportWorkerProcessor`)
```text
1. markRunning(backgroundJobId)
2. Load meeting_minutes (KHÔNG lock — chỉ đọc snapshot tại thời điểm xử lý)
3. IF includeTranscript AND linkedTranscriptId != NULL: load transcript content
4. Render:
   - format='pdf'  -> renderMeetingMinutesPdf(data) -> Buffer
   - format='docx' -> renderMeetingMinutesDocx(data) -> Buffer
5. storageService.saveFile({ buffer, originalName: `minutes-${minutesId}.${ext}`, folder: 'exports' })
6. mediaFile = mediaFileRepo.create({
     fileName, fileType: MediaFileType.EXPORT, mimeType, storageProvider, storageKey,
     fileSizeBytes, relatedEntityType: 'meeting_minutes', relatedEntityId: minutesId,
     visibilityLevel: MediaVisibilityLevel.INTERNAL, isActive: true,
   }) -> save
7. backgroundJobsService.markCompleted(backgroundJobId, { fileName, format, outputFileId: mediaFile.id })
8. manager.update(BackgroundJobEntity, backgroundJobId, { outputFileId: mediaFile.id })
9. IF isDefaultExport (format='pdf' AND includeTranscript=true AND includeActionItems=true):
     manager.update(MeetingMinutesEntity, minutesId, { fileId: mediaFile.id })
10. auditLogsService.logAction({ userId: requestedByUserId, actionType: 'meeting_minutes_exported',
     entityType: 'meeting_minutes', entityId: minutesId,
     metadataJson: { format, mediaFileId: mediaFile.id, includeTranscript, includeActionItems } })
CATCH (bất kỳ bước nào lỗi):
   backgroundJobsService.markFailed(backgroundJobId, errMsg)  -- KHÔNG throw tiếp (ARCH-02)
```

### 7.3 Key Business Rules Implemented
Chỉ `preparedBy`/`meeting.hostId`/Admin tạo job được, chỉ khi `status=published`, validate đầy đủ trước khi enqueue (không validate trong worker), `file_id` chỉ đổi bởi export mặc định, lỗi worker không throw tiếp/không lộ stack trace ra ngoài.

## 8. Validation Plan

### 8.1 Input Validation (DTO — `CreateMeetingMinutesExportDto`)
- `format`: `@IsIn(['pdf', 'docx'])`, bắt buộc.
- `includeTranscript`: `@IsOptional() @IsBoolean()`, default `false`.
- `includeActionItems`: `@IsOptional() @IsBoolean()`, default `true`.
- `id` (path param): `ParseUUIDPipe`.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → ownership-or-admin → status published → tạo job.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải published | `ConflictException` | `MINUTES_NOT_PUBLISHED` |
| `format` không hợp lệ | `BadRequestException` (DTO) | `VALIDATION_ERROR` |

### 9.2 Worker Error Handling
Toàn bộ `process()` bọc try/catch — mọi lỗi (render/storage/DB) đều dẫn tới `markFailed`, không throw tiếp (tránh BullMQ crash worker hoặc auto-retry vô hạn với lỗi vĩnh viễn như "biên bản đã bị xóa giữa lúc job đang chờ trong queue").

## 10. Testing Strategy

### 10.1 Unit Tests — Service (`createExportJob`)
Happy path tự export (preparedBy), happy path host-thay-thế, happy path Business Admin, happy path System Admin, not-owner-not-admin (403), status không phải published kể cả Admin (409), biên bản không tồn tại/đã xóa (404), format không hợp lệ (400 — DTO level), job được tạo với đúng `jobType=EXPORT_MINUTES` và `inputJson`.

### 10.2 Unit Tests — Worker (`MinutesExportWorkerProcessor`)
Render PDF thành công → `markCompleted` + `MediaFileEntity` đúng `fileType=EXPORT`; render Word thành công; export mặc định → `meeting_minutes.file_id` được cập nhật; export tùy biến (docx hoặc tắt include-option) → `file_id` KHÔNG đổi; `includeTranscript=true` nhưng `linkedTranscriptId=NULL` → vẫn hoàn tất, không lỗi; lỗi render (giả lập exception) → `markFailed`, không throw tiếp; audit log ghi đúng `action_type`.

### 10.3 Unit Tests — Controller
Trả `202` đúng format response; propagate lỗi 403/404/409/400 từ service.

### 10.4 Integration Test Ideas (không bắt buộc trong phạm vi PR này)
Export thật 1 biên bản có transcript + action items, chạy worker thật (hoặc mock queue chạy đồng bộ trong test), assert file buffer PDF/DOCX không rỗng, assert `media_files` + `background_jobs.output_file_id` khớp nhau.

## 11. Implementation Phases

### Phase 1: Dependency & DTO
Thêm `docx` vào `package.json`. Tạo `CreateMeetingMinutesExportDto`, `CreateMeetingMinutesExportResponseDto`.

### Phase 2: Service Logic
`MinutesService.createExportJob()` (hoặc tách riêng `MinutesExportService` nếu `MinutesService` đã quá lớn — quyết định lúc code dựa trên độ dài file thật).

### Phase 3: Renderer
`renderers/meeting-minutes-pdf-renderer.ts` (mirror cấu trúc `reports/renderers/meeting-activity-pdf-renderer.ts`), `renderers/meeting-minutes-docx-renderer.ts` (dùng thư viện `docx` mới).

### Phase 4: Worker Processor
`processors/minutes-export-worker.processor.ts` (`@Processor('minutes-export')`), đăng ký trong `minutes.module.ts` (`BullModule.registerQueue` KHÔNG cần — queue đã đăng ký global qua `QueueModule`, chỉ cần import `QueueModule`/đăng ký processor như 1 provider).

### Phase 5: Controller Endpoint
Thêm route `POST :id/exports` vào `MeetingMinutesListController` (cùng vị trí đã thêm `POST :id/issue`).

### Phase 6: Seed & Tests
Migration seed permission `meeting.minutes.export`, unit test service + worker + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Thư viện `docx` (npm, chưa từng dùng trong dự án) có API/learning curve khác `pdfkit` | Tách renderer thành file riêng, viết unit test render độc lập trước khi tích hợp vào worker |
| Worker chạy trong module `minutes` cần `@Processor('minutes-export')` — nếu quên import `QueueModule`/đăng ký provider đúng cách, job sẽ bị "treo" ở `queued` vĩnh viễn (không có worker nào lắng nghe) | Verify bằng cách enqueue job thật trong integration test, assert `status` chuyển sang `running`/`completed` trong thời gian hợp lý |
| Nhầm quyền ghi `file_id` — vô tình ghi đè cho MỌI lần export thay vì chỉ export mặc định | Unit test riêng AC-005/AC-006, đặt điều kiện `isDefaultExport` rõ ràng thành 1 hàm/biến boolean độc lập, dễ test |
| Ownership-or-admin check sai (copy nhầm từ `issueMinutes` nhưng quên đổi status check từ `draft` sang `published`) | Unit test riêng cho từng nhánh, đối chiếu trực tiếp với `feat-issue-meeting-minutes` |
| Lỗi render/storage làm crash worker, kéo theo các job khác trong cùng queue không được xử lý | Bọc try/catch toàn bộ `process()`, test riêng case lỗi (AC-018) |
| `MeetingMinutesListController` đã khá nhiều route (`GET`/`PATCH`/`DELETE`/`POST :id/issue`/`PATCH :id/link-resources`/...) — route `POST :id/exports` mới cần đặt đúng vị trí, không trùng path với route khác | Đặt ngay sau `POST :id/issue` (cùng nhóm "action" theo `id`), verify bằng cách chạy lại toàn bộ test suite của `minutes` module sau khi thêm route |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.7.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
