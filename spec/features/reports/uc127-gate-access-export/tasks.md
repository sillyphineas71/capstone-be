# Tasks: Xuất báo cáo ra vào khuôn viên (UC-127)

**Feature**: RPT-EXPORT-GATE-ACCESS-001
**Module**: reports
**Branch**: `tai-branch`
**Date**: 2026-07-23

**Input documents**: spec.md, plan.md

## Path Conventions

- Source files: `src/modules/reports/` (module đã có sẵn sau UC-AA-12/UC-RUM-16 — mở rộng thêm, KHÔNG viết lại từ đầu)
- Tái dùng NGUYÊN VẸN, KHÔNG SỬA: `BackgroundJobsService`, `QueueService`, `MediaFilesService`/`StorageService`, endpoint `GET /api/v1/background-jobs/:id`, `GET /media-files/:fileId`
- **SỬA có kiểm soát**: `MeetingActivityReportWorkerProcessor.process()` — thêm 1 nhánh dispatch mới (xem T-Processor bên dưới), KHÔNG đổi hành vi nhánh `export:meeting-activity`/`export:room-utilization` hiện có
- Queue đã đăng ký sẵn: `'report-export'` — dùng đúng tên này
- **Cần seed permission mới**: `report.gate_access.export`

---

## Phase 1: Setup

- [ ] T101 [P] Tạo `src/modules/reports/dto/create-gate-access-export.dto.ts`
- [ ] T102 [P] Tạo `src/modules/reports/controllers/gate-access-report.controller.ts`
- [ ] T103 [P] Tạo `src/modules/reports/services/gate-access-report.service.ts`
- [ ] T104 [P] Tạo `src/modules/reports/services/gate-access-report-data.service.ts`
- [ ] T105 [P] Tạo `src/modules/reports/processors/gate-access-report-worker.processor.ts`
- [ ] T106 [P] Tạo `src/modules/reports/renderers/gate-access-pdf-renderer.ts`
- [ ] T107 [P] Tạo `src/modules/reports/renderers/gate-access-xlsx-renderer.ts`
- [ ] T108 [P] Tạo test file rỗng cho 3 service/worker mới trong `src/modules/reports/tests/`

---

## Phase 2: Foundational

- [ ] T109 [FR-015, FR-016, FR-017] Implement `CreateGateAccessExportDto`
  - `@IsDateString() from`, `to` (bắt buộc)
  - `@IsIn(['pdf','xlsx']) format` (bắt buộc)
  - `scope?: { zoneId?: UUID, departmentId?: UUID, userId?: UUID }` (nested DTO, `@ValidateNested`)

- [ ] T110 [P] Cập nhật `report-export-job.constants.ts`: thêm `export const GATE_ACCESS_EXPORT_JOB_NAME = 'export:gate-access';`

- [ ] T111 [FR-004] Tạo `GateAccessReportController` shell
  - `@Controller('reports/gate-access')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('report.gate_access.export')` class-level
  - `@Post('exports') @HttpCode(202) createExport(@Body() dto, @CurrentUser() currentUser)`

- [ ] T112 [FR-001–FR-003] Tạo `GateAccessReportService` shell — inject `AuthzReadRepository`, `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService`

- [ ] T113 [Module] Cập nhật `reports.module.ts`
  - Thêm `GateAccessLogEntity`, `ZoneEntity` vào `TypeOrmModule.forFeature`
  - Đăng ký `GateAccessReportController` vào `controllers`
  - Đăng ký `GateAccessReportService`, `GateAccessReportDataService`, `GateAccessReportWorkerProcessor` vào `providers`
  - Inject `GateAccessReportWorkerProcessor` vào constructor của `MeetingActivityReportWorkerProcessor` (mirror `roomUtilizationWorker` đã có)

---

## Phase 3: Business Logic — Validation, Scope & Job Creation

- [ ] T114 [FR-015, FR-018] Validate `from`/`to` + `maxRangeDays` (mirror `MeetingActivityReportService.validateDateRange/validateMaxRangeDays`)

- [ ] T115 [FR-006, FR-007, FR-014] Implement `resolveScope(currentUser, scope, roles)`
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → không giới hạn
  - `MANAGER` → `SELECT id FROM departments WHERE manager_user_id = :userId`; `scope.departmentId` ngoài phạm vi → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})` (áp dụng tương tự cho `scope.userId` nếu user đó không thuộc phòng ban quản lý — CL-1 spec §5.6, xem T115a)

- [ ] T115a [CL-1] Verify `scope.userId` do MANAGER truyền: JOIN `users.department_id` của `userId` đó, đối chiếu phòng ban quản lý — ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`

- [ ] T116 [FR-005, FR-025] Implement `createExportJob(currentUser, dto)` hoàn chỉnh
  - `BackgroundJobsService.createQueuedJob({jobType: EXPORT_REPORT, requestedBy, inputJson:{from,to,format,scope:resolvedScope}})`
  - `QueueService.addJob('report-export', GATE_ACCESS_EXPORT_JOB_NAME, {backgroundJobId, from, to, format, scope:resolvedScope, requestedByEmail})`
  - Trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`
  - Audit log non-blocking `action_type='export_gate_access_report'`

---

## Phase 4: Worker — Tổng hợp dữ liệu (`GateAccessReportDataService`)

- [ ] T117 [FR-021, FR-022, FR-023, FR-024] Implement `listSessionsForExport(params)`
  - CTE `sessions` mirror `GateAccessHistoryService.SESSIONS_CTE` (self-join `paired_log_id`, JOIN `zones z ON z.deleted_at IS NULL`)
  - Thêm `WHERE session_status = 'completed'` (loại `'incomplete'` — §0.3 spec, KHÁC `GateAccessHistoryService` gốc)
  - LEFT JOIN `users u ON u.id = sessions.user_id`, LEFT JOIN `departments d ON d.id = u.department_id`
  - Filter: `zoneId` (`sessions.zone_id`), `departmentId` (`u.department_id`), `userId` (`sessions.user_id`), `access_time`/`check_in_time` trong `[from,to]`
  - `ORDER BY COALESCE(check_in_time, check_out_time) ASC`, KHÔNG `LIMIT`
  - Trả field: `zoneCode, zoneName, employeeCode, fullName, departmentName, plateNumber, checkInTime, checkOutTime, durationSeconds`

---

## Phase 5: Worker — Render file, Upload & Dispatch

- [ ] T118 [FR-024] Implement `renderGateAccessPdf(rows, meta)` trong `gate-access-pdf-renderer.ts` — bảng 1 dòng/1 phiên + tổng hợp đầu trang, trả `Buffer`

- [ ] T119 [FR-024] Implement `renderGateAccessXlsx(rows, meta)` trong `gate-access-xlsx-renderer.ts` — 1 sheet, trả `Buffer`

- [ ] T120 [FR-008, FR-009] Implement `GateAccessReportWorkerProcessor.processExport(job)` (plain `@Injectable()`, KHÔNG `@Processor` — mirror `RoomUtilizationReportWorkerProcessor`)
  - `markRunning` → `listSessionsForExport` → render theo `format` → lưu `StorageService` → tạo `MediaFileEntity` → `markCompleted` + set `output_file_id`
  - Catch toàn bộ → `markFailed`, KHÔNG throw tiếp

- [ ] T121 [⚠️ CRITICAL — Processor Gate] SỬA `MeetingActivityReportWorkerProcessor.process()`
  - Thêm TRƯỚC dòng `if (job.name !== 'export:meeting-activity') return;`:
    ```ts
    if (job.name === 'export:gate-access') {
      return this.gateAccessWorker.processExport(job);
    }
    ```
  - Inject `gateAccessWorker: GateAccessReportWorkerProcessor` vào constructor
  - **Verify bằng test**: job `export:gate-access` được dispatch đúng, KHÔNG rơi vào nhánh `return` im lặng cuối hàm

---

## Phase 6: Seed & Error Handling

- [ ] T122 [Seed] Tạo `src/database/migrations/20260724000001-SeedReportGateAccessExportPermission.ts`
  - **Trước khi viết**: `ls src/database/migrations | sort | tail -5` để xác nhận đúng số tiếp theo thật tại thời điểm code (không giả định `20260724000001` cố định)
  - Permission `report.gate_access.export`, gán `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

- [ ] T123 [Error] Catch lỗi không lường trước ở service tạo job → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 7: Testing

- [ ] T124 [Test, AC-004, AC-005] [P] Unit test validate/scope (T114, T115, T115a)
- [ ] T125 [Test, AC-001] [P] Unit test `createExportJob()` (T116) — đúng `QueueService.addJob('report-export','export:gate-access',...)`
- [ ] T126 [Test, AC-002, AC-003] [P] Unit test `listSessionsForExport()` (T117)
  - Phiên `incomplete` KHÔNG xuất hiện
  - Phiên vãng lai (`user_id=null`) VẪN xuất hiện khi không filter department/user
  - Filter `zoneId`/`departmentId`/`userId` đúng
- [ ] T127 [Test] [P] Unit test renderer (T118, T119)
- [ ] T128 [Test, AC-001, AC-006] [P] Unit test `GateAccessReportWorkerProcessor.processExport()` (T120) — happy path, lỗi → failed, rỗng → completed
- [ ] T129 [Test, ⚠️ CRITICAL] [P] Unit test `MeetingActivityReportWorkerProcessor.process()` dispatch đúng job `export:gate-access` (T121) — regression test cho 2 nhánh cũ vẫn hoạt động
- [ ] T130 [Test] [P] Unit test seed permission

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T131 [Polish] Verify response tạo job đúng format `{success, message, data, meta}`
- [ ] T132 [Polish] Verify KHÔNG sửa `GateAccessHistoryService`/`GateAccessPairingService`/`BackgroundJobsService`/`QueueService`/`StorageService`
- [ ] T133 [Polish] Verify raw SQL dùng parameter binding
- [ ] T134 [Polish] Verify CHỈ 1 `@Processor('report-export')` tồn tại trong toàn repo (`grep -rn "@Processor('report-export')" src/`)
- [ ] T135 [Test] Chạy lại toàn bộ AC ở spec.md §7

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** → **Phase 3** (song song với **Phase 4**) → **Phase 5** (phụ thuộc Phase 4) → **Phase 6** (song song Phase 3-5) → **Phase 7** (phụ thuộc 3-6) → **Phase 8**
- **T121 (sửa `MeetingActivityReportWorkerProcessor`) PHẢI làm SAU T120** (cần `GateAccessReportWorkerProcessor` tồn tại để inject)

### Parallel Opportunities

- Phase 1: T101-T108 song song
- Phase 4: độc lập với Phase 3, có thể làm song song
- Phase 7: T124-T130 song song

---

## Implementation Strategy (MVP)

1. Phase 1 + 2 — API tạo job tồn tại, trả lỗi tạm
2. Phase 3 — Endpoint tạo job hoàn chỉnh
3. Phase 4 + 5 — Worker xử lý đầy đủ, **đặc biệt T121 KHÔNG ĐƯỢC BỎ SÓT** (nếu bỏ sót, job tạo được nhưng không bao giờ chạy — lỗi im lặng khó phát hiện qua test hời hợt)
4. Phase 6 — Seed permission
5. Phase 7 — Test toàn bộ, ưu tiên T129 (dispatch) và T126 (lọc session)
6. Phase 8 — Polish

MVP = Phase 1 → Phase 6.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T112, T116, T120 |
| FR-004 | T111 |
| FR-005 | T116 |
| FR-006, FR-007 | T115 |
| FR-008, FR-009 | T120 |
| FR-010 | T120, T128 |
| FR-011 | T117 |
| FR-012–FR-018 | T109, T114, T115 |
| FR-019, FR-020 | T115 |
| FR-021–FR-024 | T117, T118, T119 |
| FR-025 | T116 |
| FR-026 | T115 |
