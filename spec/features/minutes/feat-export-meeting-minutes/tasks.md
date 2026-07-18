# Task List: Export Meeting Minutes (UC-147)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks cho feat-export-meeting-minutes (UC-147) — chưa implement, chờ lệnh triển khai | Toàn bộ file |
| 2026-07-17 | Implement xong T001-T017 (docx dep, DTOs, constants, PDF+DOCX renderer, MinutesExportService, MinutesExportWorkerProcessor, module wiring, POST :id/exports route, seed permission, 24 test — pass; build sạch). Ghi chú: export logic đặt trong MinutesExportService riêng (không sửa constructor MinutesService để tránh vỡ 15+ test hiện có). Đánh dấu hoàn thành. | Checkbox `[x]`, Phase 1-5 |

## Checklist
- [x] T001 [US1] Đọc lại `minutes.service.ts` + `minutes-list.controller.ts` + `queue.module.ts`/`queue.service.ts` thật kỹ trước khi sửa
- [x] T002 [US1] Thêm dependency `docx` vào `package.json`
- [x] T003 [US1] DTO request → `src/modules/minutes/dto/create-minutes-export.dto.ts`
- [x] T004 [US1] DTO response → `src/modules/minutes/dto/create-minutes-export-response.dto.ts`
- [x] T005 [US1] Renderer PDF → `src/modules/minutes/renderers/meeting-minutes-pdf-renderer.ts`
- [x] T006 [US1] Renderer Word → `src/modules/minutes/renderers/meeting-minutes-docx-renderer.ts`
- [x] T007 [US1] Constants queue/job name → `src/modules/minutes/constants/minutes-export-job.constants.ts`
- [x] T008 [US1] Service logic tạo job → `MinutesService.createExportJob` trong `src/modules/minutes/services/minutes.service.ts`
- [x] T009 [US1] Worker processor → `src/modules/minutes/processors/minutes-export-worker.processor.ts`
- [x] T010 [US1] Đăng ký worker provider trong `src/modules/minutes/minutes.module.ts`
- [x] T011 [US1] Controller endpoint `POST meeting-minutes/:id/exports` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T012 [US1] Migration seed permission `meeting.minutes.export` → `src/database/migrations/<timestamp>-SeedMeetingMinutesExportPermission.ts`
- [x] T013 [US1] Unit test renderer (PDF + Word) → `src/modules/minutes/renderers/*.spec.ts`
- [x] T014 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (bổ sung case `createExportJob`)
- [x] T015 [US1] Unit test worker → `src/modules/minutes/processors/minutes-export-worker.processor.spec.ts`
- [x] T016 [US1] Unit test controller → route mới trong controller test tương ứng
- [x] T017 [US1] Lint/build/test toàn repo + regression check module `minutes`/`reports`/`queue`

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại code trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`, `src/modules/minutes/controllers/minutes-list.controller.ts`, `src/modules/queue/queue.module.ts`, `src/modules/queue/queue.service.ts`
**Action**: Xác nhận cấu trúc thật của `minutes.service.ts`/`minutes-list.controller.ts` sau các feature trước (`issueMinutes`/`updateDraft`/`deleteDraft`/`linkResources`/attachments nếu đã implement). Xác nhận lại `QUEUE_MINUTES_EXPORT_NAME` vẫn được inject đúng trong `QueueService` và chưa có `@Processor('minutes-export')` nào tồn tại (tránh đăng ký trùng).
**Outcome**: Biết chính xác vị trí chèn code an toàn, xác nhận queue chưa có worker.
**Verification**: `npm run build` pass trước khi thêm code của feature này.

## Phase 1: Dependency & DTO

### Task T002 [US1] — Thêm dependency `docx`
**File**: `package.json`
**Action**: `npm install docx` (thư viện sinh file .docx bằng Node.js/TypeScript, có `@types` built-in). Xác nhận version compatible với Node LTS đang dùng trong dự án.
**Outcome**: Import `docx` dùng được trong renderer.
**Verification**: `npm run build` pass, không lỗi type.

### Task T003 [US1] — DTO request
**File**: `src/modules/minutes/dto/create-minutes-export.dto.ts`
**Action**: `format: 'pdf' | 'docx'` (`@IsIn(['pdf', 'docx'])`, bắt buộc), `includeTranscript?: boolean` (`@IsOptional() @IsBoolean()`, default `false`), `includeActionItems?: boolean` (`@IsOptional() @IsBoolean()`, default `true`).
**Outcome**: DTO validate đúng theo spec.md mục 8.1.
**Verification**: Unit test DTO (nếu tách riêng) hoặc cover qua T014.

### Task T004 [US1] — DTO response
**File**: `src/modules/minutes/dto/create-minutes-export-response.dto.ts`
**Action**: Định nghĩa type theo data-model.md mục 3 (`jobId, status, minutesId, format, estimatedCompletion`).
**Outcome**: Type dùng cho response controller.
**Verification**: Type-check pass.

## Phase 2: Renderer

### Task T005 [US1] — Renderer PDF
**File**: `src/modules/minutes/renderers/meeting-minutes-pdf-renderer.ts`
**Action**: Mirror cấu trúc `reports/renderers/meeting-activity-pdf-renderer.ts` (dùng `pdfkit`, trả `Promise<Buffer>`). Layout gợi ý: Header (tiêu đề biên bản, ngày ban hành) → Nội dung chính (`minutesContent`) → Quyết định (`decisionsJson`, nếu có) → Action items (`actionItemsJson`, nếu `includeActionItems=true`) → Transcript (nếu `includeTranscript=true` và có dữ liệu).
**Outcome**: Hàm `renderMeetingMinutesPdf(data): Promise<Buffer>`.
**Verification**: Unit test T013 — buffer không rỗng, mở được bằng PDF parser cơ bản (hoặc chỉ check magic bytes `%PDF`).

### Task T006 [US1] — Renderer Word
**File**: `src/modules/minutes/renderers/meeting-minutes-docx-renderer.ts`
**Action**: Dùng thư viện `docx` (mới cài ở T002), layout tương đương renderer PDF (không cần pixel-perfect giống nhau — xem FR-012). Trả `Promise<Buffer>`.
**Outcome**: Hàm `renderMeetingMinutesDocx(data): Promise<Buffer>`.
**Verification**: Unit test T013 — buffer không rỗng, đúng magic bytes `.docx` (ZIP signature `PK`).

## Phase 3: Service & Worker

### Task T007 [US1] — Constants
**File**: `src/modules/minutes/constants/minutes-export-job.constants.ts`
**Action**: `export const MINUTES_EXPORT_QUEUE_NAME = 'minutes-export';` (khớp đúng tên đã đăng ký trong `QueueModule`), `export const MINUTES_EXPORT_JOB_NAME = 'export:meeting-minutes';`.
**Outcome**: Constants dùng chung giữa service (enqueue) và worker (dispatch theo `job.name`).
**Verification**: Type-check pass.

### Task T008 [US1] — Viết `MinutesService.createExportJob`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1: load `meeting_minutes` → check tồn tại/chưa xóa mềm → check ownership-or-admin (tái dùng logic tương tự `issueMinutes`) → check `status=published` → `backgroundJobsService.createQueuedJob({jobType: EXPORT_MINUTES, ...})` → `queueService.addJob(MINUTES_EXPORT_QUEUE_NAME, MINUTES_EXPORT_JOB_NAME, {...})` → trả `202` response.
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T014 pass toàn bộ các nhánh.

### Task T009 [US1] — Worker processor
**File**: `src/modules/minutes/processors/minutes-export-worker.processor.ts`
**Action**: `@Processor(MINUTES_EXPORT_QUEUE_NAME)` extends `WorkerHost`. Implement `process(job)` theo pseudo-code plan.md mục 7.2: markRunning → load minutes (+transcript nếu cần) → render (dispatch theo `format`) → `storageService.saveFile()` → tạo `MediaFileEntity` (`fileType=EXPORT`) → `markCompleted` + update `output_file_id` → nếu là export mặc định, update `meeting_minutes.file_id` → ghi audit log → catch toàn bộ, `markFailed` nếu lỗi (KHÔNG throw tiếp).
**Outcome**: Worker xử lý job hoàn chỉnh, không crash khi lỗi.
**Verification**: Unit test T015 pass toàn bộ các nhánh (bao gồm case lỗi).

### Task T010 [US1] — Đăng ký worker provider
**File**: `src/modules/minutes/minutes.module.ts`
**Action**: Thêm `MinutesExportWorkerProcessor` vào `providers` của `MinutesModule`. KHÔNG gọi `BullModule.registerQueue()` lại cho `minutes-export` (đã đăng ký global trong `QueueModule`) — chỉ cần import `QueueModule` nếu `MinutesModule` chưa import, để `QueueService`/`@InjectQueue` hoạt động đúng trong DI graph.
**Outcome**: Worker khởi động cùng ứng dụng, sẵn sàng consume job từ queue `minutes-export`.
**Verification**: Chạy app dev, enqueue 1 job thử nghiệm, xác nhận `background_jobs.status` chuyển `queued → running → completed` trong thời gian hợp lý (không "treo" ở `queued`).

## Phase 4: Controller & Migration

### Task T011 [US1] — Thêm route `POST :id/exports`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm method controller `createExport` với `@Post(':id/exports')`, `@HttpCode(202)`, guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.export')`, `ParseUUIDPipe` cho `:id`, `@Body()` DTO, `@CurrentUser()` lấy user, gọi `minutesService.createExportJob`, trả `{ success: true, message: 'Da tao yeu cau xuat bien ban, dang xu ly', data: result }`. Đặt route ngay sau `POST :id/issue` (cùng nhóm action theo `id`).
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T016.

### Task T012 [US1] — Migration seed permission
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesExportPermission.ts`
**Action**: Copy pattern từ `20260702030000-SeedMeetingMinutesIssuePermission.ts`, đổi `code: 'meeting.minutes.export'`, `action: 'minutes.export'`, `roles: ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN']`.
**Outcome**: Permission tồn tại trong DB, gán đúng role.
**Verification**: `npm run migration:run`, query `permissions`/`role_permissions` xác nhận đã seed.

## Phase 5: Testing

### Task T013 [US1] — Unit test renderer
**File**: `src/modules/minutes/renderers/meeting-minutes-pdf-renderer.spec.ts`, `src/modules/minutes/renderers/meeting-minutes-docx-renderer.spec.ts`
**Action**: Test render với data đầy đủ, render với `decisionsJson`/`actionItemsJson`/transcript = null (không lỗi), assert buffer không rỗng + đúng magic bytes.
**Outcome**: Renderer coverage.

### Task T014 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test cases theo plan.md mục 10.1 — happy path (preparer/host/BusinessAdmin/SystemAdmin), not-owner-not-admin (403), status không phải published kể cả Admin (409), không tồn tại/đã xóa (404), job được tạo đúng `jobType`/`inputJson`/queue name.
**Outcome**: Service coverage.

### Task T015 [US1] — Unit test worker
**File**: `src/modules/minutes/processors/minutes-export-worker.processor.spec.ts`
**Action**: Test cases theo plan.md mục 10.2 — render PDF/Word thành công, export mặc định cập nhật `file_id`, export tùy biến KHÔNG cập nhật `file_id`, `includeTranscript=true` nhưng thiếu transcript vẫn hoàn tất, lỗi render → `markFailed` không throw tiếp, audit log ghi đúng.
**Outcome**: Worker coverage.

### Task T016 [US1] — Unit test controller
**File**: Controller test tương ứng (`minutes-list.controller.spec.ts` hoặc file test riêng cho export)
**Action**: Trả `202` đúng format, propagate lỗi 403/404/409/400 từ service.
**Outcome**: Controller coverage.

### Task T017 [US1] — Lint/build/test + regression
**Action**: `npm run lint`, `npm run build`, `npm run test` cho toàn repo. Regression check riêng: chạy lại test suite hiện có của `minutes` module (issue/update/delete/attach/link-resources) và `reports` module (đảm bảo không đụng nhầm queue/constants dùng chung).
**Outcome**: Không phá vỡ chức năng đã có.

---

## Requirements Coverage

| Task ID | FR liên quan | AC liên quan |
| :--- | :--- | :--- |
| T002 | FR-012 | AC-004 |
| T003, T004 | FR-016, FR-017, FR-020 | AC-013, AC-014, AC-015 |
| T005 | FR-001, FR-003, FR-011 | AC-001, AC-012 |
| T006 | FR-001, FR-003, FR-012 | AC-004 |
| T007 | FR-020 | — |
| T008 | FR-004, FR-009, FR-013, FR-014, FR-015, FR-018, FR-024 | AC-002, AC-003, AC-007, AC-008, AC-009, AC-010, AC-011, AC-016, AC-017 |
| T009 | FR-005, FR-006, FR-007, FR-008, FR-011 | AC-001, AC-005, AC-006, AC-012, AC-018, AC-019 |
| T010 | FR-002 | — |
| T011 | FR-001, FR-002, FR-019 | AC-001 |
| T012 | FR-021 | AC-008 |
| T013 | FR-012 | AC-004 |
| T014 | Tất cả FR nhánh service | AC-001-003, AC-007-011, AC-013-017 |
| T015 | Tất cả FR nhánh worker | AC-001, AC-004-006, AC-012, AC-018, AC-019 |
| T016 | — | AC-001 (format response) |

## Implementation Strategy

1. **MVP scope**: T001 → T002 → T003 → T004 → T005 → T007 → T008 → T009 → T010 → T011 → T012 (core logic + PDF only trước, verify end-to-end 1 lần)
2. **Word format bổ sung**: T006 (có thể làm song song với T005 sau khi T002 xong, không phụ thuộc lẫn nhau)
3. **Testing**: T013 → T014 → T015 → T016 → T017 (có thể parallel sau khi phase tương ứng xong)
4. **Không cần** `BullModule.registerQueue()` mới — queue `minutes-export` đã đăng ký sẵn trong `QueueModule` (chỉ cần đăng ký `@Processor` provider).
5. **Không cần** migration schema — chỉ 1 migration seed permission.
6. **Rủi ro lớn nhất cần verify sớm**: đảm bảo worker thật sự nhận được job từ queue `minutes-export` (T010 verification) — nếu sai cấu hình DI, job sẽ "treo" im lặng ở `queued` mà không có lỗi rõ ràng nào.
