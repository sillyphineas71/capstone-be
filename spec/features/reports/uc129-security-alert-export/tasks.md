# Tasks: Xuất báo cáo sự kiện an ninh (UC-129)

**Feature**: RPT-EXPORT-SECURITY-ALERT-001
**Module**: reports
**Branch**: `tai-branch`
**Date**: 2026-07-23

**Input documents**: spec.md, plan.md

## Path Conventions

- Source files: `src/modules/reports/`
- Tái dùng NGUYÊN VẸN, KHÔNG SỬA: `BackgroundJobsService`, `QueueService`, `MediaFilesService`/`StorageService`, `AlertsService`, endpoint polling/download
- **SỬA có kiểm soát**: `MeetingActivityReportWorkerProcessor.process()` — thêm nhánh dispatch mới, KHÔNG đổi hành vi các nhánh đã có (`meeting-activity`, `room-utilization`, và `gate-access`/`vehicle` nếu UC-127/128 đã code trước)
- Queue đã đăng ký sẵn: `'report-export'`
- **Cần seed permission mới**: `report.security_alert.export`
- **Khuyến nghị thứ tự code**: làm UC-129 SAU CÙNG trong 3 UC Bước 5 (ít phụ thuộc filter phức tạp nhất, rủi ro conflict thấp nếu làm cuối) — không bắt buộc, chỉ là gợi ý điều phối

---

## Phase 1: Setup

- [ ] T301 [P] Tạo `src/modules/reports/dto/create-security-alert-export.dto.ts`
- [ ] T302 [P] Tạo `src/modules/reports/controllers/security-alert-report.controller.ts`
- [ ] T303 [P] Tạo `src/modules/reports/services/security-alert-report.service.ts`
- [ ] T304 [P] Tạo `src/modules/reports/services/security-alert-report-data.service.ts`
- [ ] T305 [P] Tạo `src/modules/reports/processors/security-alert-report-worker.processor.ts`
- [ ] T306 [P] Tạo `src/modules/reports/renderers/security-alert-pdf-renderer.ts`
- [ ] T307 [P] Tạo `src/modules/reports/renderers/security-alert-xlsx-renderer.ts`
- [ ] T308 [P] Tạo test file rỗng cho 3 service/worker mới

---

## Phase 2: Foundational

- [ ] T309 [FR-013–FR-015] Implement `CreateSecurityAlertExportDto`
  - `@IsDateString() from`, `to` (bắt buộc)
  - `@IsIn(['pdf','xlsx']) format` (bắt buộc)
  - `filters?: { alertType?: string, zoneId?: UUID, status?: 'new'|'acknowledged'|'resolved' }` (nested, tất cả optional)

- [ ] T310 [P] Cập nhật `report-export-job.constants.ts`: thêm `SECURITY_ALERT_EXPORT_JOB_NAME = 'export:security-alert'`

- [ ] T311 [FR-004] Tạo `SecurityAlertReportController` shell — `@Controller('reports/security-alert')`, `@RequirePermissions('report.security_alert.export')` class-level, `POST /exports`

- [ ] T312 [FR-001–FR-003] Tạo `SecurityAlertReportService` shell — inject `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService`

- [ ] T313 [Module] Cập nhật `reports.module.ts`
  - Thêm `SecurityAlertEntity` vào `TypeOrmModule.forFeature` (kiểm tra `ZoneEntity`/`UserEntity` đã có sẵn từ UC-127/UC-AA-12 chưa trước khi thêm trùng)
  - Đăng ký `SecurityAlertReportController`, `SecurityAlertReportService`, `SecurityAlertReportDataService`, `SecurityAlertReportWorkerProcessor`
  - Inject `SecurityAlertReportWorkerProcessor` vào constructor `MeetingActivityReportWorkerProcessor`

---

## Phase 3: Business Logic — Validation & Job Creation

- [ ] T314 [FR-012, FR-016] Validate `from`/`to` + `maxRangeDays`

- [ ] T315 [FR-005, FR-021] Implement `createExportJob(currentUser, dto)`
  - KHÔNG resolve scope Manager (§2.2 spec)
  - `BackgroundJobsService.createQueuedJob({jobType: EXPORT_REPORT, requestedBy, inputJson:{from,to,format,filters}})`
  - `QueueService.addJob('report-export', SECURITY_ALERT_EXPORT_JOB_NAME, {backgroundJobId, from, to, format, filters, requestedByEmail})`
  - Trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`
  - Audit log non-blocking `action_type='export_security_alert_report'`

---

## Phase 4: Worker — Tổng hợp dữ liệu (`SecurityAlertReportDataService`)

- [ ] T316 [FR-018] Implement `listAllForExport(params)`
  - `createQueryBuilder('sa').leftJoinAndSelect('sa.zone','zone').leftJoinAndSelect('sa.acknowledgedByUser','ack').leftJoinAndSelect('sa.resolvedByUser','res')`
  - `.where('sa.triggeredAt BETWEEN :from AND :to', {from, to})`
  - `.andWhere(...)` có điều kiện cho `alertType`/`zoneId`/`status` nếu filter tương ứng có giá trị
  - `.orderBy('sa.triggeredAt', 'DESC')`, KHÔNG `.take()/.skip()`
  - Trả `SecurityAlertEntity[]` với relations đã load

- [ ] T317 [FR-019] Implement `mapToExportRow(alert)` (hàm map riêng, dùng lại được ở cả 2 renderer)
  - `zoneName = alert.zone && !alert.zone.deletedAt ? alert.zone.zoneName : 'Toàn khuôn viên'` (⚠️ CRITICAL — mirror `AlertsService.findDetail()`, KHÔNG bỏ sót check `deletedAt`)
  - `acknowledgedByName = alert.acknowledgedByUser?.fullName ?? null`
  - `resolvedByName = alert.resolvedByUser?.fullName ?? null`
  - Trả object phẳng đủ field FR-019

- [ ] T318 [FR-020, §5.6 CL-1] Implement `getStatusCounts(alerts)` — `{new: count, acknowledged: count, resolved: count}` (COUNT thuần trên mảng đã lấy, KHÔNG query riêng)

---

## Phase 5: Worker — Render file, Upload & Dispatch

- [ ] T319 [FR-019] Implement `renderSecurityAlertPdf(rows, statusCounts, meta)` trong `security-alert-pdf-renderer.ts` — bảng 1 dòng/1 alert + tổng hợp đầu trang, trả `Buffer`

- [ ] T320 [FR-019] Implement `renderSecurityAlertXlsx(rows, statusCounts, meta)` trong `security-alert-xlsx-renderer.ts` — 1 sheet, trả `Buffer`

- [ ] T321 [FR-006, FR-007] Implement `SecurityAlertReportWorkerProcessor.processExport(job)` (plain `@Injectable()`)
  - `markRunning` → `listAllForExport` (T316) → `mapToExportRow` từng dòng (T317) → `getStatusCounts` (T318) → render theo `format` (T319/T320) → lưu `StorageService` → tạo `MediaFileEntity` → `markCompleted`
  - Catch toàn bộ → `markFailed`, KHÔNG throw tiếp

- [ ] T322 [⚠️ CRITICAL — Processor Gate] SỬA `MeetingActivityReportWorkerProcessor.process()`
  - Đọc kỹ state hiện tại của file TRƯỚC khi sửa (có thể đã có nhánh `export:gate-access`/`export:vehicle` từ UC-127/128)
  - Thêm `if (job.name === 'export:security-alert') return this.securityAlertWorker.processExport(job);` TRƯỚC dòng return cuối, SAU các nhánh đã có
  - Inject `securityAlertWorker: SecurityAlertReportWorkerProcessor` vào constructor
  - **Verify bằng test**: TẤT CẢ nhánh (`meeting-activity`, `room-utilization`, `gate-access`, `vehicle`, `security-alert` — tùy đã code bao nhiêu UC) dispatch đúng, không nhánh nào bị che khuất/rơi vào `return` im lặng cuối hàm

---

## Phase 6: Seed & Error Handling

- [ ] T323 [Seed] Tạo `src/database/migrations/20260724000003-SeedReportSecurityAlertExportPermission.ts`
  - **Trước khi viết**: `ls src/database/migrations | sort | tail -5` để xác nhận số tiếp theo thật (điều phối với migration UC-127/128 nếu code cùng đợt — KHÔNG trùng số)
  - Permission `report.security_alert.export`, gán `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

- [ ] T324 [Error] Catch lỗi không lường trước ở service tạo job → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 7: Testing

- [ ] T325 [Test, AC-004, AC-005] [P] Unit test validate (T309, T314)
- [ ] T326 [Test, AC-001] [P] Unit test `createExportJob()` (T315)
- [ ] T327 [Test, AC-002, AC-003] [P] Unit test `listAllForExport()`/`mapToExportRow()` (T316, T317)
  - `zoneId=null` → `zoneName='Toàn khuôn viên'`
  - Zone đã soft-delete (`deletedAt` khác null) → CŨNG `'Toàn khuôn viên'`, KHÔNG lộ tên zone cũ (⚠️ CRITICAL)
  - `status='new'` → `acknowledgedByName`/`resolvedByName` đều `null`
  - `status='resolved'` → có đủ `resolvedByName`, `resolutionNote`
- [ ] T328 [Test] [P] Unit test `getStatusCounts()` (T318)
- [ ] T329 [Test] [P] Unit test renderer (T319, T320)
- [ ] T330 [Test, AC-001, AC-006] [P] Unit test `SecurityAlertReportWorkerProcessor.processExport()` (T321) — happy path, lỗi → failed, rỗng → completed
- [ ] T331 [Test, ⚠️ CRITICAL] [P] Unit test dispatch `MeetingActivityReportWorkerProcessor.process()` cho `export:security-alert` (T322) — regression test TẤT CẢ nhánh khác đã có
- [ ] T332 [Test] [P] Unit test seed permission

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T333 [Polish] Verify response tạo job đúng format `{success, message, data, meta}`
- [ ] T334 [Polish] Verify KHÔNG sửa `AlertsService`/`BackgroundJobsService`/`QueueService`
- [ ] T335 [Polish] Verify CHỈ 1 `@Processor('report-export')` tồn tại trong toàn repo — kiểm tra CUỐI CÙNG sau khi cả 3 UC Bước 5 đã code (`grep -rn "@Processor('report-export')" src/`)
- [ ] T336 [Polish] Verify KHÔNG có field/logic phân tích suy luận nào ngoài liệt kê + đếm status (BR1 SRS, OOS-003)
- [ ] T337 [Test] Chạy lại toàn bộ AC ở spec.md §7
- [ ] T338 [Test] Chạy lại TOÀN BỘ test suite module `reports` (cả 3 UC Bước 5 + 2 UC gốc UC-AA-12/UC-RUM-16) để xác nhận không hồi quy sau nhiều lần sửa chung 1 file `process()`

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** → **Phase 3** (song song **Phase 4**) → **Phase 5** (phụ thuộc Phase 4) → **Phase 6** (song song 3-5) → **Phase 7** (phụ thuộc 3-6) → **Phase 8**
- **T322 PHẢI làm SAU T321**, và SAU KHI đã xác nhận trạng thái hiện tại của `MeetingActivityReportWorkerProcessor.process()` (có thể đã có nhánh từ UC-127/128)

### Parallel Opportunities

- Phase 1: T301-T308 song song
- Phase 7: T325-T332 song song

---

## Implementation Strategy (MVP)

1. Phase 1 + 2 — API tạo job tồn tại, trả lỗi tạm
2. Phase 3 — Endpoint tạo job hoàn chỉnh
3. Phase 4 + 5 — Worker xử lý đầy đủ, **T322 KHÔNG ĐƯỢC BỎ SÓT, đặc biệt chú ý KHÔNG ghi đè nhánh cũ**
4. Phase 6 — Seed permission
5. Phase 7 — Test toàn bộ, ưu tiên T327 (mapping zone/user) và T331 (dispatch)
6. Phase 8 — Polish, **T338 chạy full suite `reports` là bước kiểm tra cuối cùng quan trọng nhất của cả Bước 5**

MVP = Phase 1 → Phase 6.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T312, T315, T321 |
| FR-004 | T311 |
| FR-005 | T315 |
| FR-006, FR-007 | T321 |
| FR-008 | T321, T330 |
| FR-009 | T316 |
| FR-010–FR-016 | T309, T314 |
| FR-017 | T315 |
| FR-018–FR-020 | T316, T317, T318 |
| FR-021 | T315 |
