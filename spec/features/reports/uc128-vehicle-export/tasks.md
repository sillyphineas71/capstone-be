# Tasks: Xuất báo cáo phương tiện (UC-128)

**Feature**: RPT-EXPORT-VEHICLE-001
**Module**: reports
**Branch**: `tai-branch`
**Date**: 2026-07-23

**Input documents**: spec.md, plan.md

## Path Conventions

- Source files: `src/modules/reports/`
- Tái dùng NGUYÊN VẸN, KHÔNG SỬA: `BackgroundJobsService`, `QueueService`, `MediaFilesService`/`StorageService`, `VehicleTrafficStatsService` (chỉ gọi qua DI), endpoint polling/download
- **SỬA có kiểm soát**: `MeetingActivityReportWorkerProcessor.process()` — thêm nhánh dispatch mới, KHÔNG đổi hành vi nhánh cũ (bao gồm nhánh `export:gate-access` nếu UC-127 đã code trước)
- Queue đã đăng ký sẵn: `'report-export'`
- **Cần seed permission mới**: `report.vehicle.export`

---

## Phase 1: Setup

- [ ] T201 [P] Tạo `src/modules/reports/dto/create-vehicle-export.dto.ts`
- [ ] T202 [P] Tạo `src/modules/reports/controllers/vehicle-report.controller.ts`
- [ ] T203 [P] Tạo `src/modules/reports/services/vehicle-report.service.ts`
- [ ] T204 [P] Tạo `src/modules/reports/services/vehicle-report-data.service.ts`
- [ ] T205 [P] Tạo `src/modules/reports/processors/vehicle-report-worker.processor.ts`
- [ ] T206 [P] Tạo `src/modules/reports/renderers/vehicle-pdf-renderer.ts`
- [ ] T207 [P] Tạo `src/modules/reports/renderers/vehicle-xlsx-renderer.ts`
- [ ] T208 [P] Tạo test file rỗng cho 3 service/worker mới
- [ ] T209 Verify `VehicleTrafficStatsService` đã export từ module chứa nó (`GateAccessModule`) — nếu chưa, thêm vào mảng `exports` (KHÔNG sửa logic bên trong service)

---

## Phase 2: Foundational

- [ ] T210 [FR-017–FR-020] Implement `CreateVehicleExportDto`
  - `@IsDateString() from`, `to` (bắt buộc)
  - `@IsIn(['pdf','xlsx']) format` (bắt buộc)
  - `@IsIn(['registrations','traffic_stats','both']) content` (bắt buộc)
  - `filters?: { vehicleType?: string, zoneId?: UUID }` (nested, cả 2 optional)

- [ ] T211 [P] Cập nhật `report-export-job.constants.ts`: thêm `VEHICLE_EXPORT_JOB_NAME = 'export:vehicle'`

- [ ] T212 [FR-004] Tạo `VehicleReportController` shell — `@Controller('reports/vehicle')`, `@RequirePermissions('report.vehicle.export')` class-level, `POST /exports`

- [ ] T213 [FR-001–FR-003] Tạo `VehicleReportService` shell — inject `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService`

- [ ] T214 [Module] Cập nhật `reports.module.ts`
  - Thêm `VehicleRegistrationEntity` vào `TypeOrmModule.forFeature`
  - Import module export `VehicleTrafficStatsService`
  - Đăng ký `VehicleReportController`, `VehicleReportService`, `VehicleReportDataService`, `VehicleReportWorkerProcessor`
  - Inject `VehicleReportWorkerProcessor` vào constructor `MeetingActivityReportWorkerProcessor`

---

## Phase 3: Business Logic — Validation & Job Creation

- [ ] T215 [FR-017, FR-021] Validate `from`/`to` + `maxRangeDays`

- [ ] T216 [FR-005, FR-026] Implement `createExportJob(currentUser, dto)`
  - KHÔNG resolve scope Manager (§2.2 spec — no department scope for this report)
  - `BackgroundJobsService.createQueuedJob({jobType: EXPORT_REPORT, requestedBy, inputJson:{from,to,format,content,filters}})`
  - `QueueService.addJob('report-export', VEHICLE_EXPORT_JOB_NAME, {backgroundJobId, from, to, format, content, filters, requestedByEmail})`
  - Trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`
  - Audit log non-blocking `action_type='export_vehicle_report'`

---

## Phase 4: Worker — Tổng hợp dữ liệu (`VehicleReportDataService`)

- [ ] T217 [FR-023] Implement `listRegistrationsForExport(params)`
  - `SELECT vr.plate_raw, vr.plate_number, vr.vehicle_type, vr.status, vr.note, vr.created_at, u.employee_code, u.full_name FROM vehicle_registrations vr LEFT JOIN users u ON u.id = vr.user_id WHERE vr.deleted_at IS NULL AND vr.created_at BETWEEN $1 AND $2`
  - `AND vr.vehicle_type = $N` nếu `filters.vehicleType` có
  - **KHÔNG** áp `filters.zoneId` (§0.3 spec — dù được truyền vào params cũng bỏ qua ở hàm này)
  - `ORDER BY vr.created_at DESC`, KHÔNG `LIMIT`

- [ ] T218 [FR-024] Implement `getTrafficStats(params)`
  - `return this.vehicleTrafficStatsService.getStats({from: params.from, to: params.to, zoneId: params.filters?.zoneId, vehicleType: params.filters?.vehicleType, groupBy: 'day'})`
  - KHÔNG viết thêm logic biến đổi kết quả

---

## Phase 5: Worker — Render file, Upload & Dispatch

- [ ] T219 [FR-006–FR-008, FR-025] Implement `renderVehiclePdf(data, content)` trong `vehicle-pdf-renderer.ts`
  - `data: {registrations?: Row[], trafficStats?: {summary,series}}`
  - Dựng section theo `content`: `registrations` → chỉ bảng đăng ký; `traffic_stats` → chỉ bảng summary+series; `both` → cả 2, section riêng biệt
  - Trả `Buffer`

- [ ] T220 [FR-006–FR-008, FR-025] Implement `renderVehicleXlsx(data, content)` trong `vehicle-xlsx-renderer.ts` — tương tự T219, dùng sheet riêng cho mỗi phần khi `content='both'`

- [ ] T221 [FR-009, FR-010] Implement `VehicleReportWorkerProcessor.processExport(job)` (plain `@Injectable()`)
  - `markRunning` → theo `job.data.content`, gọi T217/T218 (dùng `Promise.all` nếu `both`) → render (T219/T220 theo `format`) → lưu `StorageService` → tạo `MediaFileEntity` → `markCompleted`
  - Catch toàn bộ → `markFailed`, KHÔNG throw tiếp

- [ ] T222 [⚠️ CRITICAL — Processor Gate] SỬA `MeetingActivityReportWorkerProcessor.process()`
  - Thêm nhánh `if (job.name === 'export:vehicle') return this.vehicleWorker.processExport(job);` TRƯỚC dòng return cuối
  - Inject `vehicleWorker: VehicleReportWorkerProcessor` vào constructor
  - Nếu UC-127 đã code trước, file này đã có nhánh `export:gate-access` — chỉ THÊM nhánh mới, không xóa nhánh cũ
  - **Verify bằng test**: cả 3-4 nhánh (`meeting-activity`, `room-utilization`, `gate-access` nếu có, `vehicle`) dispatch đúng, không nhánh nào bị rơi vào `return` im lặng

---

## Phase 6: Seed & Error Handling

- [ ] T223 [Seed] Tạo `src/database/migrations/20260724000002-SeedReportVehicleExportPermission.ts`
  - **Trước khi viết**: `ls src/database/migrations | sort | tail -5` để xác nhận số tiếp theo thật (có thể trùng với migration UC-127 nếu code song song — điều phối thứ tự)
  - Permission `report.vehicle.export`, gán `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

- [ ] T224 [Error] Catch lỗi không lường trước ở service tạo job → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 7: Testing

- [ ] T225 [Test, AC-005, AC-006] [P] Unit test validate (T215, T210)
- [ ] T226 [Test, AC-001] [P] Unit test `createExportJob()` (T216)
- [ ] T227 [Test, AC-003, AC-004] [P] Unit test `listRegistrationsForExport()` (T217)
  - `status='disabled'` VẪN xuất hiện
  - `deleted_at IS NOT NULL` KHÔNG xuất hiện
  - Truyền `filters.zoneId` KHÔNG ảnh hưởng kết quả (so sánh với không truyền)
- [ ] T228 [Test] [P] Unit test `getTrafficStats()` (T218) — spy xác nhận gọi ĐÚNG `VehicleTrafficStatsService.getStats` với tham số đúng, KHÔNG có raw SQL riêng nào trong hàm này
- [ ] T229 [Test, AC-001, AC-002] [P] Unit test renderer 3 case `content` (T219, T220)
- [ ] T230 [Test, AC-007] [P] Unit test `VehicleReportWorkerProcessor.processExport()` (T221) — happy path 3 case content, lỗi → failed, rỗng → completed
- [ ] T231 [Test, ⚠️ CRITICAL] [P] Unit test dispatch `MeetingActivityReportWorkerProcessor.process()` cho `export:vehicle` (T222) — regression test các nhánh khác
- [ ] T232 [Test] [P] Unit test seed permission

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T233 [Polish] Verify response tạo job đúng format `{success, message, data, meta}`
- [ ] T234 [Polish] Verify KHÔNG sửa `VehicleRegistrationService`/`VehicleTrafficStatsService`/`BackgroundJobsService`/`QueueService`
- [ ] T235 [Polish] Verify raw SQL trong `listRegistrationsForExport` dùng parameter binding
- [ ] T236 [Polish] Verify CHỈ 1 `@Processor('report-export')` tồn tại trong toàn repo
- [ ] T237 [Test] Chạy lại toàn bộ AC ở spec.md §7

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** → **Phase 3** (song song **Phase 4**) → **Phase 5** (phụ thuộc Phase 4) → **Phase 6** (song song 3-5) → **Phase 7** (phụ thuộc 3-6) → **Phase 8**
- **T222 PHẢI làm SAU T221**
- Nếu UC-127 code song song/trước: điều phối T222 và task tương ứng của UC-127 (T121) để tránh 2 người cùng sửa `MeetingActivityReportWorkerProcessor.process()` cùng lúc — merge tuần tự

### Parallel Opportunities

- Phase 1: T201-T208 song song
- Phase 4: T217, T218 song song (độc lập)
- Phase 7: T225-T232 song song

---

## Implementation Strategy (MVP)

1. Phase 1 + 2 — API tạo job tồn tại, trả lỗi tạm
2. Phase 3 — Endpoint tạo job hoàn chỉnh
3. Phase 4 + 5 — Worker xử lý đầy đủ, **T222 KHÔNG ĐƯỢC BỎ SÓT**
4. Phase 6 — Seed permission
5. Phase 7 — Test toàn bộ, ưu tiên T228 (verify không fork logic UC-114) và T231 (dispatch)
6. Phase 8 — Polish

MVP = Phase 1 → Phase 6.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T213, T216, T221 |
| FR-004 | T212 |
| FR-005 | T216 |
| FR-006–FR-008 | T221, T219, T220 |
| FR-009, FR-010 | T221 |
| FR-011 | T221, T230 |
| FR-012–FR-014 | T217, T218 |
| FR-015–FR-021 | T210, T215 |
| FR-022 | T216 |
| FR-023–FR-025 | T217, T218, T219, T220 |
| FR-026 | T216 |
