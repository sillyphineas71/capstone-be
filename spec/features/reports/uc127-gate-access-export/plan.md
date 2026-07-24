# Implementation Plan: Xuất báo cáo ra vào khuôn viên (UC-127)

**Branch**: `tai-branch` | **Date**: 2026-07-23
**Spec**: spec/features/reports/uc127-gate-access-export/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phòng ban), Business Admin, System Admin tạo job bất đồng bộ xuất báo cáo ra/vào khuôn viên (PDF hoặc Excel), nguồn dữ liệu từ `gate_access_logs` đã ghép cặp (Bước 2). Copy nguyên pattern kiến trúc đã có ở `meeting-activity`/`room-utilization` — endpoint mới, data service mới, 2 renderer mới — KHÔNG tạo processor/queue mới (dùng chung `@Processor('report-export')` hiện có, dispatch thêm nhánh `job.name`).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, BullMQ (đã cấu hình), `pdfkit`, `exceljs` (đều đã có trong `package.json` sau khi UC-AA-12 thêm)
**Storage**: PostgreSQL (đọc tổng hợp `gate_access_logs`/`zones`/`users`), file output qua `StorageService` + `media_files`
**Testing**: Jest
**Target Platform**: Node.js LTS server + BullMQ worker (cùng process)
**Performance Goals**: Endpoint tạo job trả `202` dưới 500ms
**Constraints**: Read-only đối với dữ liệu nguồn; job không treo vĩnh viễn ở `running`; JOIN zone luôn kèm `deleted_at IS NULL`
**Scale**: Giới hạn `from/to` bởi `analytics.dashboard_max_range_days`; danh sách phiên không giới hạn số dòng (dữ liệu file)

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `report.gate_access.export` |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('report.gate_access.export')`; scope Manager enforce ở cả tạo job lẫn worker |
| **Scope Gate** | PASS | Chỉ 1 endpoint tạo job mới; tái dùng polling/download đã có |
| **Module Gate** | PASS | Code trong `src/modules/reports/`; đọc `gate_access_logs`/`zones`/`users` qua `TypeOrmModule.forFeature` mới trong `ReportsModule`, KHÔNG sửa module `gate-access`/`zones` |
| **API Gate** | PASS | Response `{success,message,data,meta}` |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Background Job Gate** | PASS | Dùng đúng `job_type='export_report'`, queue `report-export` đã đăng ký sẵn — KHÔNG tạo queue mới |
| **⚠️ Processor Gate (đặc thù module `reports`)** | PASS CÓ ĐIỀU KIỆN | BullMQ Worker KHÔNG tự lọc theo `job.name` — chỉ được có 1 `@Processor('report-export')` cho toàn queue (đã là `MeetingActivityReportWorkerProcessor`). PHẢI thêm nhánh `job.name === 'export:gate-access'` vào `process()` của class đó, dispatch (qua DI) sang `GateAccessReportWorkerProcessor` mới (mirror cách `RoomUtilizationReportWorkerProcessor` đã làm) — KHÔNG được gắn `@Processor` thứ 2 trên cùng queue (sẽ khiến 2 worker cùng nhận job, xử lý trùng/không kiểm soát) |
| **Test Gate** | PASS | Unit test filter scope, session_status='completed' filter, render PDF/XLSX, xử lý lỗi worker → `failed` |

## Project Structure

### Documentation (this feature)

```text
spec/features/reports/uc127-gate-access-export/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/reports/
├── reports.module.ts                                  # Update: thêm TypeOrmModule.forFeature GateAccessLogEntity/ZoneEntity, đăng ký controller/service/data-service/worker mới
├── controllers/
│   └── gate-access-report.controller.ts                # NEW: POST /reports/gate-access/exports
├── services/
│   ├── gate-access-report.service.ts                   # NEW: orchestrator — validate, scope, enqueue
│   └── gate-access-report-data.service.ts               # NEW: CTE sessions mirror GateAccessHistoryService, KHÔNG phân trang
├── processors/
│   ├── meeting-activity-report-worker.processor.ts       # UPDATE: thêm nhánh job.name==='export:gate-access' → dispatch DI
│   └── gate-access-report-worker.processor.ts            # NEW: plain @Injectable() (KHÔNG @Processor — mirror RoomUtilizationReportWorkerProcessor)
├── renderers/
│   ├── gate-access-pdf-renderer.ts                      # NEW: dùng pdfkit
│   └── gate-access-xlsx-renderer.ts                     # NEW: dùng exceljs
├── dto/
│   ├── create-gate-access-export.dto.ts                  # NEW
│   └── gate-access-export-response.dto.ts                # NEW (hoặc tái dùng CreateExportResponseDto chung nếu shape giống hệt)
├── constants/
│   └── report-export-job.constants.ts                   # UPDATE: thêm GATE_ACCESS_EXPORT_JOB_NAME='export:gate-access'
└── tests/
    ├── gate-access-report.service.spec.ts
    ├── gate-access-report-data.service.spec.ts
    └── gate-access-report-worker.processor.spec.ts

src/database/migrations/
└── 20260724000001-SeedReportGateAccessExportPermission.ts   # NEW (số tiếp theo migration cuối cùng — verify lại số thật tại thời điểm code)
```

**Structure Decision**: Đăng ký thêm `GateAccessLogEntity`, `ZoneEntity` vào `TypeOrmModule.forFeature` của `ReportsModule` (không import module `gate-access`/`zones` nguyên khối để tránh phụ thuộc chéo không cần thiết — chỉ cần đọc entity). `GateAccessReportDataService` **tự viết lại** CTE `sessions` (không import `GateAccessHistoryService`) vì service đó có API scope theo user/phân trang không khớp nhu cầu "toàn bộ dữ liệu không phân trang cho 1 file" — mirror công thức CTE, áp thêm điều kiện `session_status='completed'` mà `GateAccessHistoryService` không có (service đó cố ý giữ cả `incomplete` cho người dùng tự theo dõi).

## Complexity Tracking

1. **Dispatch đa-job-name trên 1 `@Processor` duy nhất** — đã có tiền lệ (`RoomUtilizationReportWorkerProcessor`), chỉ cần thêm 1 nhánh `if` nữa vào `MeetingActivityReportWorkerProcessor.process()`. Rủi ro: quên thêm nhánh mới → job `export:gate-access` bị bỏ qua im lặng (dòng cuối `process()` hiện tại: `if (job.name !== 'export:meeting-activity') return;` — PHẢI sửa thứ tự kiểm tra, thêm nhánh mới TRƯỚC dòng return này).
2. **CTE `sessions` viết lại (không import `GateAccessHistoryService`)** — rủi ro lệch công thức ghép cặp nếu `GateAccessHistoryService` được sửa sau này mà quên đồng bộ. Mitigation: comment trỏ rõ nguồn, unit test đối chiếu cùng bộ dữ liệu mẫu.
3. **Phiên vãng lai (`user_id=null`)** — đảm bảo JOIN `users` dùng LEFT JOIN, không loại phiên khi filter không áp dụng.

## Implementation Phases

### Phase 1: Setup

- Tạo toàn bộ file mới theo cấu trúc ở trên.
- Tạo migration seed mới.

### Phase 2: Foundational

- DTO `CreateGateAccessExportDto`: `from`, `to` (bắt buộc, `@IsDateString`), `format` (`@IsIn(['pdf','xlsx'])`), `scope?: {zoneId?, departmentId?, userId?}` (nested, đều UUID optional).
- Constants: thêm `GATE_ACCESS_EXPORT_JOB_NAME = 'export:gate-access'` vào file constants chung.
- Controller shell: `@Controller('reports/gate-access')`, `@RequirePermissions('report.gate_access.export')` class-level, `POST /exports` → `202`.
- Service shell: inject `AuthzReadRepository`, `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays`).
- Module wiring: thêm `GateAccessLogEntity`, `ZoneEntity` vào `forFeature`; đăng ký controller/service/data-service/worker mới vào `providers`/`controllers`.

### Phase 3: Business Logic — Validation, Scope & Job Creation

- Validate `from/to` + `maxRangeDays` (mirror T018 của UC-AA-12).
- Resolve scope Manager: `SELECT id FROM departments WHERE manager_user_id = :userId` — MANAGER truyền `scope.departmentId`/`scope.userId` ngoài phạm vi → 403.
- Tạo `background_jobs` + enqueue `QueueService.addJob('report-export', 'export:gate-access', {...})`.

### Phase 4: Worker — Tổng hợp dữ liệu (`GateAccessReportDataService`)

- `listSessionsForExport(params)`: CTE `sessions` mirror `GateAccessHistoryService.SESSIONS_CTE`, thêm `WHERE session_status = 'completed'` (§0.3 spec), filter `zoneId`/`departmentId` (qua LEFT JOIN `users`)/`userId`, `ORDER BY COALESCE(check_in_time, check_out_time) ASC`, KHÔNG `LIMIT`.
- Trả về đủ field cho renderer: `zoneCode, zoneName, employeeCode, fullName, departmentName, plateNumber, checkInTime, checkOutTime, durationSeconds`.

### Phase 5: Worker — Render file & Upload & Dispatch

- `GateAccessReportWorkerProcessor` (plain `@Injectable()`, method `processExport(job)`) — mirror `RoomUtilizationReportWorkerProcessor`: `markRunning` → gọi data service → render → lưu `media_files` → `markCompleted`.
- **SỬA** `MeetingActivityReportWorkerProcessor.process()`: thêm `if (job.name === 'export:gate-access') return this.gateAccessWorker.processExport(job);` TRƯỚC dòng `if (job.name !== 'export:meeting-activity') return;`.
- `gate-access-pdf-renderer.ts`/`gate-access-xlsx-renderer.ts`: bảng 1 dòng/1 phiên, phần tổng hợp đầu trang (tổng số phiên, khoảng thời gian).

### Phase 6: Seed & Error Handling

- Seed `report.gate_access.export`, gán 3 role `MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN`.

### Phase 7: Testing

- Unit test validate/scope, tạo job, `listSessionsForExport` (đặc biệt: loại `incomplete`, phiên vãng lai không mất, filter department chỉ ảnh hưởng phiên có user), renderer, worker happy-path/lỗi/rỗng.

### Phase 8: Polish

- Verify KHÔNG có `@Processor` thứ 2 trên queue `report-export`.
- Verify KHÔNG sửa `GateAccessHistoryService`/`GateAccessPairingService`.
- Chạy lại toàn bộ AC ở spec.md §7.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quên thêm nhánh `job.name` mới vào `MeetingActivityReportWorkerProcessor.process()` | Job `export:gate-access` bị `return` im lặng, treo mãi ở `running` (đã `markRunning` nhưng không worker nào xử lý tiếp) — **thực ra job sẽ KHÔNG bao giờ được markRunning vì bị return ngay đầu `process()`, treo ở `queued`/`waiting` trong BullMQ, không lộ lỗi rõ ràng** | Unit test `MeetingActivityReportWorkerProcessor.process()` PHẢI có case `job.name==='export:gate-access'` gọi đúng `gateAccessWorker.processExport` |
| CTE `sessions` viết lại lệch so với `GateAccessHistoryService` gốc (vd quên `deleted_at IS NULL` khi JOIN zone) | Báo cáo sai lệch dữ liệu so với API tra cứu UC-117 | Test đối chiếu cùng bộ dữ liệu mẫu giữa 2 service |
| Filter `departmentId` vô tình loại phiên vãng lai dù không nên | Báo cáo thiếu dữ liệu | Test case rõ: không truyền `departmentId` → phiên vãng lai vẫn xuất hiện |

## Requirements Coverage

| Requirement ID | Task/Phase |
|---|---|
| FR-001–FR-003 | Phase 3 |
| FR-004–FR-009 | Phase 3, Phase 5 |
| FR-010 | Phase 5 (worker rỗng vẫn completed) |
| FR-011 | Phase 3 |
| FR-012–FR-018 | Phase 2, Phase 3 |
| FR-019, FR-020 | Phase 3 |
| FR-021–FR-024 | Phase 4 |
| FR-025 | Phase 3 |
| FR-026 | Phase 3 |
