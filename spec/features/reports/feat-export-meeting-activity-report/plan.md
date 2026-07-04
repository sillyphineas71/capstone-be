# Implementation Plan: Xuất báo cáo tổng hợp hoạt động cuộc họp (UC-AA-12 / UC-158)

**Branch**: `027-export-meeting-activity-report` | **Date**: 2026-07-02
**Spec**: spec/features/reports/feat-export-meeting-activity-report/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phòng ban phụ trách, scope theo người tổ chức), Business Admin, System Admin tạo job bất đồng bộ xuất báo cáo tổng hợp hoạt động cuộc họp (PDF hoặc Excel) gồm 4 phần cố định. 1 endpoint mới: `POST /api/v1/reports/meeting-activity/exports` (đã có trong `API_CONTRACT` UC-158, điều chỉnh bỏ `sections`, giới hạn `delivery=download`). **Phát hiện quan trọng qua RECON code thật**: hạ tầng async đã có sẵn gần như đầy đủ — `BullMQ` đã đăng ký sẵn queue `report-export` (`QueueModule`/`QueueService`), `BackgroundJobsService` đã có đủ vòng đời (`createQueuedJob/markRunning/markCompleted/markFailed`), endpoint polling `GET /api/v1/background-jobs/:id` đã hoạt động, `MediaFilesService`/`StorageService`/endpoint `GET /media-files/:fileId` đã có sẵn để lưu và tải file, `pdfkit` đã có trong `package.json`. Feature này chỉ cần bổ sung: (1) endpoint tạo job, (2) 1 `Processor` tiêu thụ queue `report-export` (mirror `TranscriptionWorkerProcessor`), (3) logic tổng hợp dữ liệu 4 phần, (4) logic render PDF/XLSX, và (5) thêm dependency `exceljs` (Excel writer — hiện chưa có trong `package.json`).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, BullMQ (đã cấu hình), `pdfkit` (đã có), `exceljs` (**MỚI — cần thêm**), class-validator, JWT
**Storage**: PostgreSQL (đọc tổng hợp), file output lưu qua `StorageService` (local driver) + `media_files`
**Testing**: Jest
**Target Platform**: Node.js LTS server + BullMQ worker (cùng process hoặc worker process riêng theo cấu hình hiện có)
**Performance Goals**: Endpoint tạo job trả `202` dưới 500ms; job xử lý xong trong vài chục giây tùy khối lượng dữ liệu (không có SLA cứng theo UC)
**Constraints**: Read-only đối với dữ liệu nghiệp vụ nguồn; job không được treo vĩnh viễn ở `running`; scope thống nhất theo organizer cho toàn bộ 4 phần
**Scale**: Giới hạn `from/to` bởi `analytics.dashboard_max_range_days`; Phần 4 không giới hạn số dòng (file, không phải API phân trang)

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `report.meeting_activity.export` |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('report.meeting_activity.export')` (permission MỚI, seed ở feature này); scope enforce ở cả bước tạo job lẫn worker |
| **Scope Gate** | PASS | Chỉ 1 endpoint tạo job mới; KHÔNG xây lại polling/status (tái dùng `GET /api/v1/background-jobs/:id`), KHÔNG xây lại download (tái dùng `GET /media-files/:fileId`) |
| **Module Gate** | PASS | Code chính trong `src/modules/reports/`; tái dùng `BackgroundJobsService` (administration), `QueueService` (queue, global), `MediaFilesService`/`StorageService` (recording) qua import module rõ ràng — không sửa các service này |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp path `API_CONTRACT` UC-158 (field điều chỉnh đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Background Job Gate** | PASS | Dùng đúng `job_type='export_report'` (đã có sẵn trong enum `BackgroundJobType`), đúng queue `report-export` (đã đăng ký sẵn trong `QueueModule`) — không tạo job type/queue mới |
| **Test Gate** | PASS | Unit test cho scope organizer thống nhất, công thức 4 phần, render PDF/XLSX, xử lý lỗi worker → `failed` |

## Project Structure

### Documentation (this feature)

```text
spec/features/reports/feat-export-meeting-activity-report/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/reports/
├── reports.module.ts                                       # Update: từ @Module({}) rỗng → đăng ký đầy đủ
├── controllers/
│   └── meeting-activity-report.controller.ts                # NEW: POST /reports/meeting-activity/exports
├── services/
│   ├── meeting-activity-report.service.ts                   # NEW: orchestrator tạo job — validate, scope, enqueue
│   └── meeting-activity-report-data.service.ts               # NEW: tổng hợp dữ liệu 4 phần (worker gọi)
├── processors/
│   └── meeting-activity-report-worker.processor.ts            # NEW: @Processor('report-export'), mirror TranscriptionWorkerProcessor
├── renderers/
│   ├── meeting-activity-pdf-renderer.ts                      # NEW: dùng pdfkit
│   └── meeting-activity-xlsx-renderer.ts                     # NEW: dùng exceljs
├── dto/
│   ├── create-meeting-activity-export.dto.ts                  # NEW
│   └── meeting-activity-export-response.dto.ts                # NEW
├── constants/
│   └── report-export-job.constants.ts                        # NEW: REPORT_EXPORT_QUEUE_NAME='report-export', JOB_NAME
└── tests/
    ├── meeting-activity-report.service.spec.ts
    ├── meeting-activity-report-data.service.spec.ts
    └── meeting-activity-report-worker.processor.spec.ts

src/database/seeds/
└── <timestamp>-SeedReportMeetingActivityExportPermission.ts    # NEW: seed report.meeting_activity.export + gán 3 role

package.json
└── dependencies: thêm "exceljs" (NEW — chưa có; pdfkit đã có sẵn)
```

**Structure Decision**: `ReportsModule` hiện là `@Module({})` rỗng — mở rộng đầy đủ lần đầu tiên. Import `QueueModule` (đã `@Global()`, không cần import lại tường minh nhưng vẫn khai báo dependency rõ ràng trong `reports.module.ts` cho dễ đọc), `AdministrationModule` (lấy `BackgroundJobsService`), `RecordingModule` (lấy `MediaFilesService`) — hoặc export các service này từ module gốc nếu chưa export. **Quyết định kiến trúc quan trọng**: `MeetingActivityReportDataService` **tự viết lại** các câu query tổng hợp (không import repository của `analytics` module) vì tại thời điểm viết plan này, module `analytics` (UC-AA-01/05/08/09/10) **chưa có code thực tế** (mới chỉ có spec) — không thể tạo dependency vào code chưa tồn tại. Áp dụng ĐÚNG công thức đã ghi trong spec tương ứng (không suy đoán). Ghi chú cải tiến tương lai: khi `analytics` module đã code xong, có thể refactor `MeetingActivityReportDataService` để tái dùng trực tiếp các repository đó thay vì duplicate công thức.

## Complexity Tracking

Không vi phạm constitution. 3 điểm phức tạp nhất:

1. **Duplicate công thức từ 5 UC-AA khác nhau** (`meetingCount` UC-AA-01, phân loại 4 trạng thái UC-AA-05, `reservationUtilizationRate` UC-AA-08, `noShowRate` UC-AA-09, `onTimeRate` UC-AA-10) vào 1 service tổng hợp mới, với 1 scope DUY NHẤT theo organizer (khác on-time-rate gốc dùng scope attendee) — rủi ro cao nhất là lệch công thức so với spec gốc hoặc quên áp đúng override scope. Mitigation: mỗi công thức có unit test đối chiếu trực tiếp với ví dụ số liệu trong spec gốc tương ứng.
2. **Worker BullMQ mới** — mirror chính xác pattern đã có ở `TranscriptionWorkerProcessor` (`markRunning` đầu tiên, try/catch bọc toàn bộ, `markFailed` khi lỗi, không throw ra ngoài để BullMQ tự retry theo `defaultJobOptions`).
3. **2 renderer khác công nghệ** (`pdfkit` streaming-based vs `exceljs` workbook-based) — tách riêng 2 file renderer, cùng nhận 1 object dữ liệu đã chuẩn hóa (không phụ thuộc định dạng) để tránh trùng lặp logic tổng hợp.

Không cần justify vi phạm constitution — cả 3 điểm đã có kế hoạch xử lý rõ ràng.

## Implementation Phases

### Phase 1: Setup

- Thêm dependency `exceljs` vào `package.json` (chạy `npm install exceljs`).
- Tạo toàn bộ file mới theo cấu trúc ở trên trong `src/modules/reports/`.
- Tạo seed migration mới.

### Phase 2: Foundational

#### T-A: DTO

- `create-meeting-activity-export.dto.ts`: `@IsDateString() from`, `to` (bắt buộc), `@IsIn(['pdf','xlsx']) format` (bắt buộc), `scope?: { departmentId?: UUID, roomId?: UUID, organizerId?: UUID }` (nested DTO, `@ValidateNested`), `@IsOptional() @IsIn(['download']) delivery?` (mặc định `'download'`).
- `meeting-activity-export-response.dto.ts`: `CreateExportResponseDto { jobId, status: 'queued', delivery: 'download', outputFileId: null }`.

#### T-B: Constants

- `report-export-job.constants.ts`: `REPORT_EXPORT_QUEUE_NAME = 'report-export'` (khớp đúng tên đã đăng ký trong `QueueModule`), `MEETING_ACTIVITY_EXPORT_JOB_NAME = 'export:meeting-activity'`.

#### T-C: Controller shell

- `meeting-activity-report.controller.ts`: `@Controller('reports/meeting-activity')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('report.meeting_activity.export')` class-level, `@Post('exports') @HttpCode(202)` → `service.createExportJob(currentUser, dto)`.

#### T-D: Service shell

- `meeting-activity-report.service.ts`: inject `AuthzReadRepository`, `BackgroundJobsService` (tái dùng, KHÔNG sửa), `QueueService` (tái dùng, KHÔNG sửa), `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays()`). Method `createExportJob(currentUser, dto)` — throw `NotImplementedException` tạm.

#### T-E: Module wiring

- Cập nhật `reports.module.ts`: import `TypeOrmModule.forFeature([...])` cho các entity nguồn cần đọc (`MeetingEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`, `NoShowCaseEntity`, `AttendanceRecordEntity`, `MeetingParticipantEntity`, `UserEntity`, `DepartmentEntity`), import module chứa `BackgroundJobsService` và `MediaFilesService`/`StorageService`, đăng ký `MeetingActivityReportController`, `MeetingActivityReportService`, `MeetingActivityReportDataService`, `MeetingActivityReportWorkerProcessor` vào `providers`/`controllers`.

### Phase 3: Business Logic — Validation, Scope & Job Creation

#### T-F: Validate `from`/`to` + `maxRangeDays`

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` (UC-AA-01) → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`. Thiếu `from`/`to` hoặc `from>to` → `VALIDATION_ERROR`.

#### T-G: Resolve scope Manager (theo organizer, tĩnh — tái dùng pattern UC-AA-01/04-09)

- `resolveDepartmentScope(currentUser)`: viết SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId` trong `MeetingActivityReportService` (không import service khác).
- MANAGER truyền `scope.departmentId` ngoài phạm vi → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

#### T-H: Validate `delivery`

- Khác `undefined`/`'download'` → `BadRequestException({code:'VALIDATION_ERROR'})` (§0.4 spec.md).

#### T-I: Tạo `background_jobs` + enqueue BullMQ

- Gọi `BackgroundJobsService.createQueuedJob({ jobType: EXPORT_REPORT, requestedBy: currentUser.id, inputJson: {from,to,format,scope:resolvedScope,delivery:'download'} })` → nhận `backgroundJob.id`.
- Gọi `QueueService.addJob(REPORT_EXPORT_QUEUE_NAME, MEETING_ACTIVITY_EXPORT_JOB_NAME, { backgroundJobId: backgroundJob.id, from, to, format, scope: resolvedScope, requestedByEmail: currentUser.email })`.
- Trả `202 { jobId: backgroundJob.id, status:'queued', delivery:'download', outputFileId:null }`.

### Phase 4: Worker — Tổng hợp dữ liệu 4 phần (`MeetingActivityReportDataService`)

#### T-J: Phần 2 — `getCoreKpis(params)`

- `meetingCount`: đếm `meetings` `status<>'draft'` trong scope+kỳ (tái dùng công thức UC-AA-01 FR-026).
- `reservationUtilizationRate`: `bookedHours(room_bookings hợp lệ) ÷ (operatingHoursPerDay × số_ngày × số_phòng_active_trong_scope)` (tái dùng công thức UC-AA-08, đọc `analytics.room_operating_hours_per_day` qua precedence có sẵn).
- `noShowRate`: `noShowCount(no_show_cases.detection_status IN confirmed,released qua booking) ÷ totalBookings(room_bookings hợp lệ)`, theo `reserved_start_time` (tái dùng công thức UC-AA-09).
- `onTimeRate`: `onTimeCount ÷ totalRequiredParticipants` (gồm absent), chỉ `meetings.status='completed'`, **scope theo organizer** (KHÔNG chuyển sang attendee — §0.3 spec.md, khác UC-AA-10 gốc).

#### T-K: Phần 3 — `getStatusBreakdown(params)`

- Tái dùng nguyên thứ tự phân loại UC-AA-05 §0.3: `Cancelled → No-show (qua no_show_cases join room_bookings) → Completed → Scheduled`, loại `draft/pending_approval/in_progress`. Trả `{status, count, percentage}[]` đủ 4 nhóm.

#### T-L: Phần 4 — `getMeetingDetailList(params)`

- Liệt kê mọi `meetings` trong scope+kỳ: `meetingCode, title, organizerEmail (JOIN users), roomName (JOIN rooms qua room_bookings), startTime, endTime, status`.
- `participationRate` mỗi dòng = `(present+late) ÷ totalInvited` cho đúng `meetingId` đó (JOIN `meeting_participants` + `attendance_records`, đúng công thức §0.8 spec.md — KHÔNG dùng công thức on-time).
- Không giới hạn số dòng trả về (đây là dữ liệu cho file, không phải API phân trang).

#### T-M: Phần 1 — `getReportMetadata(params, requestedByEmail)`

- `organizationLabel`: nếu có `scope.departmentId` → `departments.department_name`; ngược lại → nhãn cố định (§0.11 spec.md).
- `period: {from,to}`, `extractedByEmail: requestedByEmail`, `generatedAt: new Date()`.

### Phase 5: Worker — Render file & Upload

#### T-N: Implement `MeetingActivityReportWorkerProcessor`

- `@Processor(REPORT_EXPORT_QUEUE_NAME)`, `extends WorkerHost`, mirror `TranscriptionWorkerProcessor`:
  1. `await backgroundJobsService.markRunning(backgroundJobId)`
  2. Gọi 4 hàm T-J/T-K/T-L/T-M để có đủ dữ liệu
  3. `format==='pdf'` → gọi `meeting-activity-pdf-renderer.ts` (T-O); `format==='xlsx'` → gọi `meeting-activity-xlsx-renderer.ts` (T-P)
  4. Lưu file qua `StorageService` (local driver, path theo cấu hình `STORAGE_LOCAL_PATH` đã có), tạo record `MediaFileEntity` (`fileType=EXPORT`, `relatedEntityType='background_job'`, `relatedEntityId=backgroundJobId`) qua `MediaFilesService`
  5. `await backgroundJobsService.markCompleted(backgroundJobId, {fileName, format})` — cập nhật `output_file_id` trỏ tới `media_files` vừa tạo (theo đúng cơ chế `markCompleted` hiện có, xem cần bổ sung tham số `outputFileId` nếu hàm hiện tại chưa hỗ trợ — xem T-Q)
  6. Catch toàn bộ lỗi → `await backgroundJobsService.markFailed(backgroundJobId, error.message)`, không throw tiếp (đúng pattern `ARCH-02` không làm crash worker)

#### T-O: `meeting-activity-pdf-renderer.ts` (dùng `pdfkit`)

- Nhận object dữ liệu đã chuẩn hóa từ T-J/K/L/M, dàn trang theo 4 phần (heading, bảng KPI, bảng phân bổ trạng thái, bảng danh sách chi tiết — dùng `doc.table`/tự vẽ text theo cột vì `pdfkit` thuần không có table helper, cân nhắc thêm `pdfkit-table` nếu cần — quyết định cụ thể khi code).
- Trả `Buffer`/stream file PDF.

#### T-P: `meeting-activity-xlsx-renderer.ts` (dùng `exceljs`)

- Sheet 1 "Tổng quan": Phần 1 + Phần 2 + Phần 3.
- Sheet 2 "Chi tiết cuộc họp": Phần 4 (1 dòng/cuộc họp).
- Trả `Buffer` file `.xlsx`.

#### T-Q: Kiểm tra/mở rộng `BackgroundJobsService.markCompleted()` nếu cần

- Hàm hiện tại `markCompleted(id, outputJson?)` **chưa nhận `outputFileId`** riêng — cần xác nhận có cột `output_file_id` được set ở đâu (có thể cần thêm tham số hoặc gọi `repo.update` trực tiếp cho cột này trong processor). **Không sửa method signature chung nếu ảnh hưởng module khác đang dùng** — nếu cần, thêm overload/tham số optional mới, giữ tương thích ngược.

### Phase 6: Seed & Error Handling

#### T-R: Seed permission mới

- `src/database/seeds/<timestamp>-SeedReportMeetingActivityExportPermission.ts`: tạo `report.meeting_activity.export`, gán `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng `API_CONTRACT` UC-158).

#### T-S: Error handling ở controller/service (tạo job)

- Lỗi tạo `background_jobs`/enqueue BullMQ không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 7: Testing

#### T-T: Unit test validation + scope (T-F, T-G, T-H)

- `from`/`to` thiếu/sai/`from>to` → lỗi.
- Range vượt `analytics.dashboard_max_range_days` → `DATE_RANGE_TOO_LARGE`.
- Manager `scope.departmentId` ngoài phạm vi → `DEPARTMENT_OUT_OF_SCOPE`.
- `delivery` khác `'download'` → `VALIDATION_ERROR`.
- `format` không thuộc `{pdf,xlsx}` → `VALIDATION_ERROR`.

#### T-U: Unit test tạo job (T-I)

- Gọi đúng `BackgroundJobsService.createQueuedJob` với `jobType=EXPORT_REPORT`.
- Gọi đúng `QueueService.addJob('report-export', ...)` với payload đủ field.
- Trả đúng `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.

#### T-V: Unit test `getCoreKpis()` — **quan trọng nhất, đối chiếu công thức từng UC-AA gốc**

- `meetingCount` khớp công thức UC-AA-01.
- `reservationUtilizationRate` khớp công thức UC-AA-08 (không nhầm sang `roomOccupancyRate`).
- `noShowRate` khớp công thức UC-AA-09 (`confirmed`/`released` only, theo `reserved_start_time`).
- `onTimeRate` khớp công thức UC-AA-10 (gồm absent) NHƯNG dùng scope organizer (verify KHÔNG lẫn scope attendee của bản gốc — điểm rủi ro cao nhất).

#### T-W: Unit test `getStatusBreakdown()` (T-K)

- Meeting `status='scheduled'` có `no_show_cases` confirmed/released → xếp "No-show", không phải "Scheduled" (đúng thứ tự ưu tiên UC-AA-05).

#### T-X: Unit test `getMeetingDetailList()` (T-L)

- `participationRate` = (present+late)÷totalInvited, KHÔNG PHẢI on-time-rate (verify 1 case người tham dự trễ vẫn tính là "đã tham gia").
- Không giới hạn số dòng trả về dù meeting nhiều.

#### T-Y: Unit test renderer (T-O, T-P)

- PDF: file sinh ra hợp lệ (mở được, có đủ 4 phần — có thể verify bằng parse text cơ bản hoặc kiểm tra kích thước/metadata tối thiểu).
- XLSX: file có đúng 2 sheet, đúng số dòng Phần 4.

#### T-Z: Unit test `MeetingActivityReportWorkerProcessor` (T-N)

- Happy path: `markRunning` → aggregate → render → upload `media_files` → `markCompleted` với `outputFileId` khác null.
- Lỗi giữa chừng (vd DB timeout khi aggregate) → `markFailed`, KHÔNG throw ra ngoài, KHÔNG để job treo ở `running`.
- Case dữ liệu rỗng (không meeting nào trong kỳ) → vẫn render file hợp lệ, `markCompleted` bình thường (KHÔNG `failed`) — đúng FR-011 spec.md.

#### T-AA: Unit test seed permission

- Tạo đúng `report.meeting_activity.export`, gán đúng 3 role.

### Phase 8: Polish & Cross-Cutting Concerns

- [ ] Verify response tạo job đúng format `{success, message, data, meta}`.
- [ ] Verify KHÔNG sửa `BackgroundJobsService`/`QueueService`/`MediaFilesService` hiện có (chỉ dùng qua DI).
- [ ] Verify raw SQL trong `MeetingActivityReportDataService` dùng parameter binding.
- [ ] Verify KHÔNG có `sections` param nào lọt vào DTO (đã bỏ theo §0.2 spec.md).
- [ ] Verify KHÔNG chấp nhận `delivery` khác `'download'`.
- [ ] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end (bao gồm cả việc polling `GET /api/v1/background-jobs/:id` và tải file qua `GET /media-files/:fileId` — 2 endpoint có sẵn, chỉ verify tích hợp đúng, không sửa).

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-I, T-N, T-O |
| AC-002 | T-G, T-J-T-L (áp scope) |
| AC-003 | T-N, T-P |
| AC-004 | T-G |
| AC-005 | T-H |
| AC-006 | T-A (DTO enum format) |
| AC-007 | T-N (case rỗng vẫn completed) |
| AC-008 | T-K |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `analytics` module (UC-AA-01/05/08/09/10) chưa có code thực tế — phải duplicate công thức, dễ lệch nếu code sau này của `analytics` thay đổi công thức mà quên đồng bộ ở đây | 2 nguồn số liệu "cùng tên" nhưng khác giá trị trong hệ thống, gây mất lòng tin dữ liệu | Ghi rõ nguồn công thức bằng comment trỏ về từng spec UC-AA tương ứng; khi `analytics` module code xong, lên task riêng để refactor sang tái dùng repository thật thay vì duplicate |
| Nhầm scope on-time-rate (dùng attendee thay vì organizer theo quyết định §0.3) | Sai lệch nhất quán trong 1 tài liệu duy nhất, đi ngược quyết định đã duyệt | Unit test T-V dùng dữ liệu cố ý chéo (attendee khác phòng ban organizer) để phân biệt rõ |
| Worker BullMQ throw lỗi không kiểm soát ra ngoài `process()` | Job treo hoặc BullMQ tự retry vô hạn theo cấu hình mặc định, không set `failed` đúng lúc | Bọc try/catch toàn bộ `process()`, luôn `markFailed` trong catch (mirror `TranscriptionWorkerProcessor`) |
| `BackgroundJobsService.markCompleted()` hiện tại không có tham số `outputFileId` riêng | Không set được `background_jobs.output_file_id`, endpoint polling trả `outputFileId=null` dù job đã xong | T-Q: kiểm tra kỹ signature thật, bổ sung tham số optional mới (không phá vỡ caller khác) hoặc update trực tiếp cột này sau khi gọi `markCompleted` |
| Thêm `exceljs` là dependency mới | Cần đánh giá license/kích thước bundle | `exceljs` là thư viện phổ biến, MIT license, phù hợp — không phải rủi ro đáng kể, chỉ cần `npm install` |
| PDF table layout phức tạp với `pdfkit` thuần (không có table helper built-in) | Tốn thời gian code layout thủ công | Cân nhắc thêm `pdfkit-table` (nhỏ, MIT) nếu cần, quyết định cụ thể lúc code (đã ghi chú ở T-O) |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T-D, T-I, T-N |
| FR-004 | T-C |
| FR-005 | T-I |
| FR-006–FR-008 | T-G |
| FR-009 | T-N |
| FR-010 | T-N |
| FR-011 | T-N, T-Z |
| FR-012 | T-G |
| FR-013–FR-020 | T-A, T-F, T-G, T-H |
| FR-021, FR-022 | T-G |
| FR-023 | T-M |
| FR-024 | T-J |
| FR-025 | T-K |
| FR-026 | T-L |
| FR-027, FR-028 | T-O, T-P |
| FR-029 | T-I |
| FR-030, FR-031 | T-G, T-F |
