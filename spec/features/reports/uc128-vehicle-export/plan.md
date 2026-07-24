# Implementation Plan: Xuất báo cáo phương tiện (UC-128)

**Branch**: `tai-branch` | **Date**: 2026-07-23
**Spec**: spec/features/reports/uc128-vehicle-export/spec.md

## Summary

Tính năng cho phép Manager/Business Admin/System Admin tạo job bất đồng bộ xuất báo cáo phương tiện (danh sách đăng ký / thống kê lưu lượng / cả hai) ra PDF/Excel. Phần "thống kê lưu lượng" tái dùng NGUYÊN `VehicleTrafficStatsService.getStats()` (UC-114) qua DI — KHÔNG viết lại. Phần "danh sách đăng ký" cần 1 method mới (admin-wide, không scope theo userId) viết trong data service riêng của `reports`, KHÔNG sửa `VehicleRegistrationService`. Copy nguyên pattern kiến trúc BullMQ + renderer đã có, dùng chung `@Processor('report-export')` hiện có (dispatch thêm nhánh `job.name`, giống UC-127).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, BullMQ (đã cấu hình), `pdfkit`, `exceljs` (đã có)
**Storage**: PostgreSQL (đọc `vehicle_registrations`/`users` trực tiếp; đọc `iot_device_events` GIÁN TIẾP qua `VehicleTrafficStatsService`), file output qua `StorageService` + `media_files`
**Testing**: Jest
**Target Platform**: Node.js LTS server + BullMQ worker
**Performance Goals**: Endpoint tạo job trả `202` dưới 500ms
**Constraints**: Read-only; job không treo vĩnh viễn ở `running`; KHÔNG fork logic `VehicleTrafficStatsService`
**Scale**: Giới hạn `from/to` bởi `analytics.dashboard_max_range_days`; danh sách đăng ký không giới hạn số dòng

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `report.vehicle.export` |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('report.vehicle.export')` |
| **Scope Gate** | PASS | Chỉ 1 endpoint tạo job mới; tái dùng polling/download đã có |
| **Module Gate** | PASS | Code trong `src/modules/reports/`; import `VehicleTrafficStatsService` từ `GateAccessModule` (hoặc export riêng nếu cần) qua DI — KHÔNG sửa nội bộ service đó; đọc `vehicle_registrations`/`users` qua `TypeOrmModule.forFeature` mới trong `ReportsModule` |
| **API Gate** | PASS | Response `{success,message,data,meta}` |
| **Auth Gate** | PASS | `JwtAuthGuard` |
| **Background Job Gate** | PASS | Queue `report-export` đã có — KHÔNG tạo mới |
| **⚠️ Processor Gate** | PASS CÓ ĐIỀU KIỆN | Mirror đúng cách UC-127 đã làm: thêm nhánh `job.name === 'export:vehicle'` vào `MeetingActivityReportWorkerProcessor.process()`, dispatch sang `VehicleReportWorkerProcessor` mới qua DI — KHÔNG `@Processor` thứ 2 |
| **Test Gate** | PASS | Unit test 3 nhánh `content`, filter `zoneId` bị bỏ qua đúng khi `registrations`, gọi đúng `VehicleTrafficStatsService.getStats()` không fork logic |

## Project Structure

### Documentation (this feature)

```text
spec/features/reports/uc128-vehicle-export/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/reports/
├── reports.module.ts                                 # Update: thêm VehicleRegistrationEntity, import GateAccessModule (lấy VehicleTrafficStatsService) hoặc AnprModule tương ứng
├── controllers/
│   └── vehicle-report.controller.ts                   # NEW: POST /reports/vehicle/exports
├── services/
│   ├── vehicle-report.service.ts                      # NEW: orchestrator — validate, enqueue
│   └── vehicle-report-data.service.ts                  # NEW: listRegistrationsForExport() MỚI + wrapper gọi VehicleTrafficStatsService.getStats() nguyên vẹn
├── processors/
│   ├── meeting-activity-report-worker.processor.ts      # UPDATE: thêm nhánh job.name==='export:vehicle'
│   └── vehicle-report-worker.processor.ts               # NEW: plain @Injectable(), mirror RoomUtilizationReportWorkerProcessor
├── renderers/
│   ├── vehicle-pdf-renderer.ts                         # NEW: nhận {registrations?, trafficStats?}, dựng 1-2 section
│   └── vehicle-xlsx-renderer.ts                        # NEW: nhận {registrations?, trafficStats?}, dựng 1-2 sheet
├── dto/
│   └── create-vehicle-export.dto.ts                     # NEW: content enum + filters
├── constants/
│   └── report-export-job.constants.ts                  # UPDATE: thêm VEHICLE_EXPORT_JOB_NAME='export:vehicle'
└── tests/
    ├── vehicle-report.service.spec.ts
    ├── vehicle-report-data.service.spec.ts
    └── vehicle-report-worker.processor.spec.ts

src/database/migrations/
└── 20260724000002-SeedReportVehicleExportPermission.ts   # NEW (verify số thật tại thời điểm code)
```

**Structure Decision**: `VehicleReportDataService.listRegistrationsForExport(filters)` viết raw SQL/QueryBuilder mới, KHÔNG gọi `VehicleRegistrationService.list()` (khác scope: admin-wide vs owner-scoped, khác input). `VehicleReportDataService.getTrafficStats(filters)` CHỈ là 1 wrapper mỏng gọi `VehicleTrafficStatsService.getStats()` — inject service đó qua DI (cần export từ `GateAccessModule` nếu chưa export, KHÔNG sửa logic bên trong).

## Complexity Tracking

1. **Trộn 2 nguồn dữ liệu khác entity/khác cơ chế filter** (`vehicle_registrations` trực tiếp vs `iot_device_events` gián tiếp qua service khác) vào cùng 1 file khi `content='both'` — renderer phải nhận input dạng `{registrations?: Row[], trafficStats?: {summary,series}}` (cả 2 optional) để tránh renderer phải biết logic `content`.
2. **Dispatch đa-job-name trên `@Processor` duy nhất** — lặp lại đúng pattern đã áp dụng ở UC-127 (xem `uc127-gate-access-export/plan.md` §Complexity Tracking mục 1) — 2 nhánh mới (`export:gate-access`, `export:vehicle`) cùng tồn tại trong 1 hàm `process()`.
3. **Filter `zoneId` có điều kiện theo `content`** — validate ở tầng DTO chỉ kiểm tra UUID hợp lệ; quyết định "áp dụng hay bỏ qua" nằm ở tầng data service (`VehicleReportDataService`), KHÔNG ở DTO/controller (tránh 400 sai khi user chọn `both` + `zoneId` hợp lệ).

## Implementation Phases

### Phase 1: Setup

- Tạo toàn bộ file mới theo cấu trúc ở trên.
- Tạo migration seed mới.
- Kiểm tra `VehicleTrafficStatsService` đã được export từ module chứa nó (`GateAccessModule`) — nếu chưa, bổ sung export (không sửa logic).

### Phase 2: Foundational

- DTO `CreateVehicleExportDto`: `from`, `to` (bắt buộc), `format` (`@IsIn(['pdf','xlsx'])`), `content` (`@IsIn(['registrations','traffic_stats','both'])`), `filters?: {vehicleType?: string, zoneId?: UUID}`.
- Constants: thêm `VEHICLE_EXPORT_JOB_NAME = 'export:vehicle'`.
- Controller shell: `@Controller('reports/vehicle')`, `@RequirePermissions('report.vehicle.export')`.
- Service shell: inject `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService`.
- Module wiring: thêm `VehicleRegistrationEntity` vào `forFeature`, import module export `VehicleTrafficStatsService`, đăng ký controller/service/data-service/worker mới, inject `VehicleReportWorkerProcessor` vào `MeetingActivityReportWorkerProcessor`.

### Phase 3: Business Logic — Validation & Job Creation

- Validate `from/to` + `maxRangeDays`, `content` enum, `format` enum.
- KHÔNG cần resolve scope Manager (§2.2 spec — không giới hạn phòng ban cho báo cáo này).
- Tạo `background_jobs` + enqueue `QueueService.addJob('report-export', 'export:vehicle', {...})`.

### Phase 4: Worker — Tổng hợp dữ liệu (`VehicleReportDataService`)

- `listRegistrationsForExport(filters)`: `SELECT ... FROM vehicle_registrations vr LEFT JOIN users u ON u.id=vr.user_id WHERE vr.deleted_at IS NULL AND vr.created_at BETWEEN :from AND :to [AND vr.vehicle_type = :vehicleType]` — KHÔNG áp `zoneId` (§0.3 spec) dù filter có được truyền vào hàm hay không.
- `getTrafficStats(filters)`: `return this.vehicleTrafficStatsService.getStats({from, to, zoneId: filters.zoneId, vehicleType: filters.vehicleType, groupBy: 'day'})` — gọi thẳng, KHÔNG biến đổi.

### Phase 5: Worker — Render file & Upload & Dispatch

- `VehicleReportWorkerProcessor.processExport(job)`: `markRunning` → theo `content` gọi 1 hoặc cả 2 hàm Phase 4 (song song `Promise.all` nếu `content='both'`) → render → lưu `media_files` → `markCompleted`.
- **SỬA** `MeetingActivityReportWorkerProcessor.process()`: thêm nhánh `job.name === 'export:vehicle'` (cùng chỗ đã sửa cho UC-127 — gộp 2 lần sửa cùng 1 vị trí trong file nếu code song song với UC-127, tránh conflict merge).
- `vehicle-pdf-renderer.ts`/`vehicle-xlsx-renderer.ts`: nhận `{registrations?, trafficStats?}`, dựng section/sheet tương ứng field nào có mặt.

### Phase 6: Seed & Error Handling

- Seed `report.vehicle.export`, gán 3 role.

### Phase 7: Testing

- Unit test validate, tạo job, `listRegistrationsForExport` (đặc biệt: disabled vẫn có mặt, soft-deleted bị loại, `zoneId` không ảnh hưởng), `getTrafficStats` (verify gọi đúng `VehicleTrafficStatsService.getStats` với đúng tham số, KHÔNG fork logic — dùng spy/mock), renderer 3 trường hợp `content`, worker happy-path/lỗi/rỗng, dispatch đúng job.

### Phase 8: Polish

- Verify KHÔNG sửa `VehicleRegistrationService`/`VehicleTrafficStatsService`.
- Verify CHỈ 1 `@Processor('report-export')` tồn tại.
- Chạy lại AC ở spec.md §7.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Fork logic `VehicleTrafficStatsService` thay vì gọi qua DI (vô tình viết lại SQL tương tự) | 2 nguồn số liệu lưu lượng khác nhau trong hệ thống, dễ lệch khi 1 bên sửa mà quên bên kia | Code review checklist + test spy xác nhận `VehicleReportDataService.getTrafficStats` gọi ĐÚNG method của `VehicleTrafficStatsService`, không có raw SQL riêng cho phần này |
| Quên thêm nhánh `job.name==='export:vehicle'` vào processor dùng chung (lặp lại rủi ro đã ghi ở UC-127) | Job treo mãi, không bao giờ `markRunning` | Test dispatch riêng, mirror `uc127-gate-access-export` |
| `zoneId` bị áp nhầm vào phần registrations nếu code cẩu thả (copy-paste từ UC-127 quên bỏ) | Sai lệch dữ liệu, khác đúng quyết định §0.3 đã duyệt | Test case rõ: `content='registrations'` + `zoneId` truyền vào → kết quả KHÔNG đổi so với không truyền `zoneId` |
| Conflict merge nếu code UC-127 và UC-128 cùng lúc sửa `MeetingActivityReportWorkerProcessor.process()` | Git conflict tại cùng 1 vị trí file | Làm tuần tự (UC-127 trước, UC-128 sau) hoặc merge cẩn thận nếu song song |

## Requirements Coverage

| Requirement ID | Task/Phase |
|---|---|
| FR-001–FR-003 | Phase 3 |
| FR-004–FR-010 | Phase 3, Phase 5 |
| FR-011 | Phase 5 |
| FR-012–FR-014 | Phase 4 |
| FR-015–FR-021 | Phase 2, Phase 3 |
| FR-022 | Phase 3 |
| FR-023–FR-025 | Phase 4, Phase 5 |
| FR-026 | Phase 3 |
