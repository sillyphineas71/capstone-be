# Tasks: Xuất báo cáo tổng hợp hoạt động cuộc họp (UC-AA-12 / UC-158)

**Feature**: RPT-EXPORT-MEETING-ACTIVITY-001 — Export Meeting Activity Report
**Module**: reports
**Branch**: `027-export-meeting-activity-report`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md

## Path Conventions

- Source files: `src/modules/reports/` (module hiện đang RỖNG `@Module({})` — build đầy đủ lần đầu)
- Tái dùng NGUYÊN VẸN, KHÔNG SỬA: `BackgroundJobsService` (administration), `QueueService`/`QueueModule` (queue, `@Global()`), `MediaFilesService`/`StorageService` (recording), endpoint `GET /api/v1/background-jobs/:id` và `GET /media-files/:fileId` (đã hoạt động)
- Queue đã đăng ký sẵn: `'report-export'` (env `QUEUE_REPORT_EXPORT`) trong `QueueModule` — dùng đúng tên này, KHÔNG tạo queue mới
- `BackgroundJobType.EXPORT_REPORT` đã có sẵn trong enum — dùng đúng giá trị này
- **Cần thêm dependency mới**: `exceljs` (chưa có trong `package.json`; `pdfkit` đã có sẵn)
- **Cần seed permission mới**: `report.meeting_activity.export`

---

## Phase 1: Setup

- [ ] T001 Chạy `npm install exceljs` — thêm dependency mới vào `package.json`
- [ ] T002 [P] Tạo `src/modules/reports/dto/create-meeting-activity-export.dto.ts`
- [ ] T003 [P] Tạo `src/modules/reports/dto/meeting-activity-export-response.dto.ts`
- [ ] T004 [P] Tạo `src/modules/reports/constants/report-export-job.constants.ts`
- [ ] T005 [P] Tạo `src/modules/reports/controllers/meeting-activity-report.controller.ts`
- [ ] T006 [P] Tạo `src/modules/reports/services/meeting-activity-report.service.ts`
- [ ] T007 [P] Tạo `src/modules/reports/services/meeting-activity-report-data.service.ts`
- [ ] T008 [P] Tạo `src/modules/reports/processors/meeting-activity-report-worker.processor.ts`
- [ ] T009 [P] Tạo `src/modules/reports/renderers/meeting-activity-pdf-renderer.ts`
- [ ] T010 [P] Tạo `src/modules/reports/renderers/meeting-activity-xlsx-renderer.ts`
- [ ] T011 [P] Tạo `src/modules/reports/tests/meeting-activity-report.service.spec.ts`, `meeting-activity-report-data.service.spec.ts`, `meeting-activity-report-worker.processor.spec.ts`

---

## Phase 2: Foundational

- [ ] T012 [FR-016, FR-017, FR-018, FR-019] [P] Implement `CreateMeetingActivityExportDto` trong `create-meeting-activity-export.dto.ts`
  - `@IsDateString() from: string`
  - `@IsDateString() to: string`
  - `@IsIn(['pdf','xlsx']) format: string`
  - `@IsOptional() @ValidateNested() @Type(() => ExportScopeDto) scope?: ExportScopeDto`
  - `ExportScopeDto { @IsOptional() @IsUUID() departmentId?; @IsOptional() @IsUUID() roomId?; @IsOptional() @IsUUID() organizerId?; }`
  - `@IsOptional() @IsIn(['download']) delivery?: string`

- [ ] T013 [FR-005] [P] Implement DTO response trong `meeting-activity-export-response.dto.ts`
  - `CreateExportResponseDto { jobId: string; status: 'queued'; delivery: 'download'; outputFileId: null }`

- [ ] T014 [P] Implement constants trong `report-export-job.constants.ts`
  - `export const REPORT_EXPORT_QUEUE_NAME = 'report-export';` (khớp đúng tên đã đăng ký trong `QueueModule`)
  - `export const MEETING_ACTIVITY_EXPORT_JOB_NAME = 'export:meeting-activity';`

- [ ] T015 [FR-004] Tạo `MeetingActivityReportController` (shell) trong `meeting-activity-report.controller.ts`
  - `@Controller('reports/meeting-activity')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('report.meeting_activity.export')` class-level
  - `@Post('exports') @HttpCode(202) createExport(@Body() dto: CreateMeetingActivityExportDto, @CurrentUser() currentUser)`

- [ ] T016 [FR-001, FR-002, FR-003] Tạo `MeetingActivityReportService` (shell) trong `meeting-activity-report.service.ts`
  - Inject: `AuthzReadRepository`, `BackgroundJobsService` (tái dùng), `QueueService` (tái dùng), `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays()`)
  - `createExportJob(currentUser, dto)` — throw `NotImplementedException` tạm

- [ ] T017 [Module] Cập nhật `src/modules/reports/reports.module.ts` (từ `@Module({})` rỗng)
  - Import `TypeOrmModule.forFeature([MeetingEntity, RoomBookingEntity, RoomBookingUsageEntity, NoShowCaseEntity, AttendanceRecordEntity, MeetingParticipantEntity, UserEntity, DepartmentEntity])`
  - Import module chứa `BackgroundJobsService` (administration), `MediaFilesService`/`StorageService` (recording) — đảm bảo các service này đã được export từ module gốc, nếu chưa thì bổ sung export (không sửa logic bên trong)
  - Đăng ký `MeetingActivityReportController` vào `controllers`
  - Đăng ký `MeetingActivityReportService`, `MeetingActivityReportDataService`, `MeetingActivityReportWorkerProcessor` vào `providers`

---

## Phase 3: Business Logic — Validation, Scope & Job Creation

- [ ] T018 [FR-016, FR-020] Implement validate `from`/`to` + `maxRangeDays` trong `MeetingActivityReportService`
  - Thiếu `from`/`to` hoặc `from>to` → `BadRequestException({code:'VALIDATION_ERROR'})`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng UC-AA-01, KHÔNG tạo config mới) → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T019 [FR-006, FR-007, FR-015, FR-021] Implement `resolveDepartmentScope(currentUser)` trong `MeetingActivityReportService`
  - Viết SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId`
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → không giới hạn
  - MANAGER truyền `scope.departmentId` ngoài phạm vi → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`

- [ ] T020 [FR-018] Implement validate `delivery` trong `MeetingActivityReportService`
  - Khác `undefined`/`'download'` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T021 [FR-005, FR-029] Implement `createExportJob(currentUser, dto)` hoàn chỉnh trong `MeetingActivityReportService`
  - Thứ tự: validate (T018, T020) → resolve scope (T019) → `BackgroundJobsService.createQueuedJob({jobType: BackgroundJobType.EXPORT_REPORT, requestedBy: currentUser.id, inputJson: {from,to,format,scope:resolvedScope,delivery:'download'}})`
  - `QueueService.addJob(REPORT_EXPORT_QUEUE_NAME, MEETING_ACTIVITY_EXPORT_JOB_NAME, {backgroundJobId, from, to, format, scope:resolvedScope, requestedByEmail: currentUser.email})`
  - Trả `{jobId: backgroundJob.id, status:'queued', delivery:'download', outputFileId:null}`
  - Audit log non-blocking `action_type='export_meeting_activity_report'`, `entity_type='background_jobs'`, `entity_id=jobId` (gated `AUDIT_LOG_ENABLED`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 4: Worker — Tổng hợp dữ liệu 4 phần

- [ ] T022 [FR-023] Implement `getReportMetadata(params, requestedByEmail)` trong `meeting-activity-report-data.service.ts` (Phần 1)
  - `scope.departmentId` có → `departments.department_name`; không có → nhãn cố định
  - Trả `{organizationLabel, period:{from,to}, extractedByEmail, generatedAt: new Date()}`

- [ ] T023 [FR-024] Implement `getCoreKpis(params)` trong `meeting-activity-report-data.service.ts` (Phần 2) — **quan trọng nhất**
  - `meetingCount`: `COUNT(meetings) WHERE status<>'draft'` trong scope+kỳ (công thức UC-AA-01 FR-026)
  - `reservationUtilizationRate`: `SUM(bookedHours hợp lệ) ÷ (operatingHoursPerDay × soNgay × activeRoomCount)` (công thức UC-AA-08, đọc `analytics.room_operating_hours_per_day` qua precedence có sẵn)
  - `noShowRate`: `noShowCount(no_show_cases.detection_status IN ('confirmed','released') qua booking_id) ÷ totalBookings(room_bookings status hợp lệ)`, theo `reserved_start_time` (công thức UC-AA-09)
  - `onTimeRate`: `onTimeCount ÷ totalRequiredParticipants` (gồm absent), chỉ `meetings.status='completed'`, **scope theo organizer** (KHÔNG chuyển sang attendee — verify kỹ, điểm rủi ro cao nhất của toàn feature)

- [ ] T024 [FR-025] Implement `getStatusBreakdown(params)` trong `meeting-activity-report-data.service.ts` (Phần 3)
  - Tái dùng nguyên thứ tự phân loại UC-AA-05: `status='cancelled'` → Cancelled; còn lại có `no_show_cases` confirmed/released → No-show; còn lại `status='completed'` → Completed; còn lại `status='scheduled'` → Scheduled; loại `draft/pending_approval/in_progress`
  - Trả `{status, count, percentage}[]` đủ 4 nhóm, `percentage` trên tổng 4 nhóm hợp lệ

- [ ] T025 [FR-026] Implement `getMeetingDetailList(params)` trong `meeting-activity-report-data.service.ts` (Phần 4)
  - JOIN `meetings` + `users` (organizer) + `room_bookings` + `rooms`
  - `participationRate` mỗi dòng = `(present+late) ÷ totalInvited` cho đúng `meetingId` đó (JOIN `meeting_participants` + `attendance_records`) — KHÔNG dùng công thức on-time-rate
  - Không giới hạn `LIMIT` số dòng trả về

---

## Phase 5: Worker — Render file & Upload

- [ ] T026 [FR-027] Implement `renderMeetingActivityPdf(data)` trong `meeting-activity-pdf-renderer.ts`
  - Dùng `pdfkit`, dàn trang theo 4 phần (heading + nội dung mỗi phần), trả `Buffer`
  - Đánh giá dùng thêm `pdfkit-table` nếu cần table layout phức tạp (quyết định lúc code)

- [ ] T027 [FR-028] Implement `renderMeetingActivityXlsx(data)` trong `meeting-activity-xlsx-renderer.ts`
  - Dùng `exceljs`, sheet "Tổng quan" (Phần 1+2+3), sheet "Chi tiết cuộc họp" (Phần 4), trả `Buffer`

- [ ] T028 [FR-009, FR-010] Implement `MeetingActivityReportWorkerProcessor.process(job)` trong `meeting-activity-report-worker.processor.ts`
  - `@Processor(REPORT_EXPORT_QUEUE_NAME)`, `extends WorkerHost` (mirror `TranscriptionWorkerProcessor`)
  - Bọc toàn bộ trong try/catch:
    1. `await backgroundJobsService.markRunning(backgroundJobId)`
    2. Gọi T022-T025 để lấy đủ dữ liệu
    3. `format==='pdf'` → T026; `format==='xlsx'` → T027
    4. Lưu file qua `StorageService`, tạo `MediaFileEntity` qua `MediaFilesService` (`fileType=EXPORT`, `relatedEntityType='background_job'`, `relatedEntityId=backgroundJobId`)
    5. `await backgroundJobsService.markCompleted(backgroundJobId, {fileName, format})` + set `output_file_id` (xem T029)
  - Catch: `await backgroundJobsService.markFailed(backgroundJobId, error.message)`, KHÔNG throw tiếp (đúng ARCH-02, không crash worker)

- [ ] T029 [FR-009] Kiểm tra/mở rộng `BackgroundJobsService.markCompleted()` để hỗ trợ `outputFileId`
  - Đọc kỹ signature hiện tại (`markCompleted(id, outputJson?)`) — xác nhận có set được cột `output_file_id` hay không
  - Nếu chưa: thêm tham số optional mới (không phá vỡ caller khác đang dùng, vd `TranscriptionWorkerProcessor`) HOẶC update trực tiếp cột `output_file_id` bằng 1 câu `UPDATE` riêng trong processor này sau khi gọi `markCompleted` — chọn cách ít xâm lấn nhất tới service dùng chung

---

## Phase 6: Seed & Error Handling

- [ ] T030 [Seed] Tạo `src/database/seeds/<timestamp>-SeedReportMeetingActivityExportPermission.ts`
  - Tạo permission `report.meeting_activity.export`
  - Gán cho 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng `API_CONTRACT` UC-158)

---

## Phase 7: Testing

- [ ] T031 [Test, AC-004, AC-005, AC-006] [P] Unit test validation + scope (T018-T020)
  - `from`/`to` thiếu/sai/`from>to` → `VALIDATION_ERROR`
  - Range vượt `analytics.dashboard_max_range_days` → `DATE_RANGE_TOO_LARGE`
  - Manager `scope.departmentId` ngoài phạm vi → `DEPARTMENT_OUT_OF_SCOPE`
  - `delivery` khác `'download'` → `VALIDATION_ERROR`
  - `format` không thuộc `{pdf,xlsx}` → `VALIDATION_ERROR`

- [ ] T032 [Test, AC-001] [P] Unit test `createExportJob()` (T021)
  - Gọi đúng `BackgroundJobsService.createQueuedJob` với `jobType=EXPORT_REPORT`
  - Gọi đúng `QueueService.addJob('report-export', 'export:meeting-activity', ...)` với payload đủ field
  - Trả đúng `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`

- [ ] T033 [Test, AC-002] [P] Unit test `getCoreKpis()` (T023) — **quan trọng nhất, đối chiếu công thức từng UC-AA gốc**
  - `meetingCount` khớp công thức UC-AA-01
  - `reservationUtilizationRate` khớp công thức UC-AA-08 (không nhầm `roomOccupancyRate`)
  - `noShowRate` khớp công thức UC-AA-09 (`confirmed`/`released` only, theo `reserved_start_time`)
  - `onTimeRate` khớp công thức UC-AA-10 (gồm absent) NHƯNG dùng scope organizer — dùng dữ liệu cố ý chéo (attendee khác phòng ban organizer) để verify KHÔNG lẫn scope attendee gốc

- [ ] T034 [Test, AC-008] [P] Unit test `getStatusBreakdown()` (T024)
  - Meeting `status='scheduled'` có `no_show_cases` confirmed/released → xếp "No-show", không phải "Scheduled"

- [ ] T035 [Test] [P] Unit test `getMeetingDetailList()` (T025)
  - `participationRate` = (present+late)÷totalInvited, KHÔNG PHẢI on-time-rate (verify người tham dự trễ vẫn tính là "đã tham gia")
  - Không giới hạn số dòng trả về dù nhiều meeting

- [ ] T036 [Test, AC-003] [P] Unit test renderer (T026, T027)
  - PDF: file sinh ra hợp lệ, đủ 4 phần
  - XLSX: đúng 2 sheet, đúng số dòng Phần 4

- [ ] T037 [Test, AC-001, AC-007] [P] Unit test `MeetingActivityReportWorkerProcessor` (T028)
  - Happy path: `markRunning` → aggregate → render → upload `media_files` → `markCompleted` với `outputFileId` khác null
  - Lỗi giữa chừng → `markFailed`, KHÔNG throw ra ngoài, KHÔNG treo ở `running`
  - Dữ liệu rỗng (không meeting nào trong kỳ) → vẫn `markCompleted` bình thường (KHÔNG `failed`)

- [ ] T038 [Test] [P] Unit test seed permission `report.meeting_activity.export`
  - Tạo đúng permission, gán đúng 3 role

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T039 [Polish] Verify response tạo job đúng format `{success, message, data, meta}`
- [ ] T040 [Polish] Verify KHÔNG sửa `BackgroundJobsService`/`QueueService`/`MediaFilesService`/`StorageService` hiện có — chỉ dùng qua Dependency Injection
- [ ] T041 [Polish] Verify raw SQL trong `MeetingActivityReportDataService` dùng parameter binding, không nối chuỗi
- [ ] T042 [Polish] Verify KHÔNG có field `sections` nào lọt vào DTO/logic (đã bỏ theo OOS-002 spec.md)
- [ ] T043 [Polish] Verify KHÔNG chấp nhận `delivery` khác `'download'` (OOS-001 spec.md)
- [ ] T044 [Polish] Verify KHÔNG tạo route mới cho polling/download — chỉ dùng `GET /api/v1/background-jobs/:id` và `GET /media-files/:fileId` có sẵn (OOS-003 spec.md)
- [ ] T045 [Polish] Verify `job_type='export_report'` và queue `'report-export'` dùng đúng giá trị đã có sẵn, không tạo type/queue mới
- [ ] T046 [Test] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end (bao gồm polling job + tải file qua 2 endpoint có sẵn)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Validation/Scope/Job Creation)**: Phụ thuộc Phase 2
- **Phase 4 (Tổng hợp dữ liệu)**: Phụ thuộc Phase 2 (độc lập với Phase 3, có thể làm song song)
- **Phase 5 (Render & Upload)**: Phụ thuộc Phase 4
- **Phase 6 (Seed)**: Độc lập, có thể làm song song với Phase 3-5
- **Phase 7 (Testing)**: Phụ thuộc Phase 3, 4, 5, 6
- **Phase 8 (Polish)**: Phụ thuộc Phase 7

### Parallel Opportunities

- Phase 1: T002-T011 song song (khác file, sau khi T001 cài dependency xong)
- Phase 4: T022-T025 song song (4 hàm độc lập trong cùng service, không phụ thuộc lẫn nhau)
- Phase 7: T031-T038 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tạo job tồn tại, trả lỗi tạm; cài `exceljs`
2. Phase 3 — Endpoint tạo job hoàn chỉnh (validation, scope, enqueue BullMQ)
3. Phase 4 + Phase 5 — Worker xử lý đầy đủ: tổng hợp 4 phần đúng công thức, render PDF/XLSX, upload file, cập nhật job hoàn tất
4. Phase 6 — Seed permission mới
5. Phase 7 — Unit test toàn bộ nhánh (đặc biệt T033 đối-chiếu-công-thức và T037 worker-happy-path/lỗi là 2 điểm rủi ro cao nhất)
6. Phase 8 — Polish, verify không sửa service dùng chung, verify không tạo route/queue/job-type trùng

MVP = Phase 1 → Phase 6 (job tạo được, worker xử lý xong, tải được file qua endpoint có sẵn).

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T016, T021, T028 |
| FR-004 | T015 |
| FR-005 | T021 |
| FR-006–FR-008 | T019 |
| FR-009 | T028, T029 |
| FR-010 | T028 |
| FR-011 | T028, T037 |
| FR-012 | T019 |
| FR-013–FR-020 | T012, T018, T019, T020 |
| FR-021, FR-022 | T019 |
| FR-023 | T022 |
| FR-024 | T023 |
| FR-025 | T024 |
| FR-026 | T025 |
| FR-027, FR-028 | T026, T027 |
| FR-029 | T021 |
| FR-030, FR-031 | T019, T018 |
