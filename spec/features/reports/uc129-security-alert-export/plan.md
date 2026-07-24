# Implementation Plan: Xuất báo cáo sự kiện an ninh (UC-129)

**Branch**: `tai-branch` | **Date**: 2026-07-23
**Spec**: spec/features/reports/uc129-security-alert-export/spec.md

## Summary

Tính năng cho phép Manager/Business Admin/System Admin tạo job bất đồng bộ xuất báo cáo sự kiện an ninh (PDF/Excel), nguồn dữ liệu `security_alerts` (Bước 3). Copy nguyên pattern kiến trúc BullMQ + renderer đã có (như UC-127/UC-128), dùng chung `@Processor('report-export')` (dispatch thêm nhánh `job.name`). Data service mới đọc trực tiếp `security_alerts` (KHÔNG sửa `AlertsService`), JOIN `zones`/`users` 2 lần lấy tên người xử lý.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, BullMQ (đã cấu hình), `pdfkit`, `exceljs` (đã có)
**Storage**: PostgreSQL (đọc `security_alerts`/`zones`/`users`), file output qua `StorageService` + `media_files`
**Testing**: Jest
**Target Platform**: Node.js LTS server + BullMQ worker
**Performance Goals**: Endpoint tạo job trả `202` dưới 500ms
**Constraints**: Read-only; job không treo vĩnh viễn ở `running`; JOIN zone luôn kèm `deleted_at IS NULL`; KHÔNG suy luận/tổng hợp chỉ số phân tích mới ngoài liệt kê + đếm status (BR1 SRS)
**Scale**: Giới hạn `from/to` bởi `analytics.dashboard_max_range_days`; không giới hạn số dòng cứng (§0.3 spec)

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `report.security_alert.export` |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('report.security_alert.export')` |
| **Scope Gate** | PASS | Chỉ 1 endpoint tạo job mới; tái dùng polling/download đã có |
| **Module Gate** | PASS | Code trong `src/modules/reports/`; đọc `SecurityAlertEntity`/`ZoneEntity`/`UserEntity` qua `TypeOrmModule.forFeature` mới trong `ReportsModule` — KHÔNG sửa module `alerts` |
| **API Gate** | PASS | Response `{success,message,data,meta}` |
| **Auth Gate** | PASS | `JwtAuthGuard` |
| **Background Job Gate** | PASS | Queue `report-export` đã có |
| **⚠️ Processor Gate** | PASS CÓ ĐIỀU KIỆN | Mirror UC-127/UC-128: thêm nhánh `job.name === 'export:security-alert'` vào `MeetingActivityReportWorkerProcessor.process()`, dispatch sang `SecurityAlertReportWorkerProcessor` mới qua DI — KHÔNG `@Processor` thứ 2 (nếu cả 3 UC Bước 5 code cùng đợt, file `process()` sẽ có TỔNG CỘNG 4-5 nhánh `if`, cần review kỹ thứ tự và không nhánh nào bị che khuất) |
| **Test Gate** | PASS | Unit test filter, JOIN người xử lý đúng, `zoneId=null` hiển thị "Toàn khuôn viên", renderer, worker |

## Project Structure

### Documentation (this feature)

```text
spec/features/reports/uc129-security-alert-export/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/reports/
├── reports.module.ts                                   # Update: thêm SecurityAlertEntity, ZoneEntity (nếu chưa có từ UC-127), UserEntity (đã có sẵn từ UC-AA-12)
├── controllers/
│   └── security-alert-report.controller.ts               # NEW: POST /reports/security-alert/exports
├── services/
│   ├── security-alert-report.service.ts                  # NEW: orchestrator — validate, enqueue
│   └── security-alert-report-data.service.ts              # NEW: listAllForExport(), KHÔNG phân trang
├── processors/
│   ├── meeting-activity-report-worker.processor.ts         # UPDATE: thêm nhánh job.name==='export:security-alert'
│   └── security-alert-report-worker.processor.ts           # NEW: plain @Injectable(), mirror RoomUtilizationReportWorkerProcessor
├── renderers/
│   ├── security-alert-pdf-renderer.ts                     # NEW
│   └── security-alert-xlsx-renderer.ts                    # NEW
├── dto/
│   └── create-security-alert-export.dto.ts                 # NEW
├── constants/
│   └── report-export-job.constants.ts                     # UPDATE: thêm SECURITY_ALERT_EXPORT_JOB_NAME='export:security-alert'
└── tests/
    ├── security-alert-report.service.spec.ts
    ├── security-alert-report-data.service.spec.ts
    └── security-alert-report-worker.processor.spec.ts

src/database/migrations/
└── 20260724000003-SeedReportSecurityAlertExportPermission.ts  # NEW (verify số thật tại thời điểm code — điều phối với UC-127/128 nếu code cùng đợt)
```

**Structure Decision**: `SecurityAlertReportDataService.listAllForExport(filters)` viết QueryBuilder mới trên `SecurityAlertEntity` (TypeORM `createQueryBuilder` — KHÔNG raw SQL, vì entity đã có sẵn relations `zone`/`acknowledgedByUser`/`resolvedByUser` khai báo, tận dụng `leftJoinAndSelect` thay vì tự viết JOIN tay, khác cách UC-127/UC-128 dùng raw SQL vì nguồn của chúng không có relations tiện lợi tương đương). KHÔNG import/sửa `AlertsService`.

## Complexity Tracking

1. **Dispatch đa-job-name trên `@Processor` duy nhất** — lặp lại pattern đã áp dụng ở UC-127/UC-128; nếu code sau cùng trong 3 UC Bước 5, file `MeetingActivityReportWorkerProcessor.process()` sẽ có nhiều nhánh — cần đọc kỹ state hiện tại của file trước khi thêm, tránh trùng lặp hoặc đặt sai thứ tự (nhánh mới phải nằm TRƯỚC dòng `return` cuối cùng).
2. **JOIN 2 lần cùng bảng `users`** (`acknowledgedByUser`, `resolvedByUser`) — dùng alias rõ ràng qua TypeORM relations sẵn có trên `SecurityAlertEntity`, tránh nhầm alias khi dùng raw SQL.
3. **`zoneId=null` là dữ liệu HỢP LỆ** (cảnh báo không gắn zone cụ thể, vd alert `crowd`/`intrusion` toàn khuôn viên) — renderer phải xử lý rõ ràng, không để trống gây hiểu nhầm lỗi dữ liệu (FR-019, AC-003).

## Implementation Phases

### Phase 1: Setup

- Tạo toàn bộ file mới theo cấu trúc ở trên.
- Tạo migration seed mới.
- Kiểm tra `ZoneEntity` đã có trong `TypeOrmModule.forFeature` của `ReportsModule` chưa (nếu UC-127 đã code trước, đã có sẵn — không đăng ký trùng).

### Phase 2: Foundational

- DTO `CreateSecurityAlertExportDto`: `from`, `to` (bắt buộc), `format` (`@IsIn(['pdf','xlsx'])`), `filters?: {alertType?: string, zoneId?: UUID, status?: 'new'|'acknowledged'|'resolved'}`.
- Constants: thêm `SECURITY_ALERT_EXPORT_JOB_NAME = 'export:security-alert'`.
- Controller shell: `@Controller('reports/security-alert')`, `@RequirePermissions('report.security_alert.export')`.
- Service shell: inject `BackgroundJobsService`, `QueueService`, `DashboardOverviewConfigService`.
- Module wiring: thêm `SecurityAlertEntity` vào `forFeature` (cùng `ZoneEntity`/`UserEntity` nếu chưa có), đăng ký controller/service/data-service/worker mới, inject `SecurityAlertReportWorkerProcessor` vào `MeetingActivityReportWorkerProcessor`.

### Phase 3: Business Logic — Validation & Job Creation

- Validate `from/to` + `maxRangeDays`, `format`, `filters.status` enum.
- KHÔNG resolve scope Manager (§2.2 spec).
- Tạo `background_jobs` + enqueue `QueueService.addJob('report-export', 'export:security-alert', {...})`.

### Phase 4: Worker — Tổng hợp dữ liệu (`SecurityAlertReportDataService`)

- `listAllForExport(params)`:
  ```ts
  this.repo.createQueryBuilder('sa')
    .leftJoinAndSelect('sa.zone', 'zone')
    .leftJoinAndSelect('sa.acknowledgedByUser', 'ack')
    .leftJoinAndSelect('sa.resolvedByUser', 'res')
    .where('sa.triggeredAt BETWEEN :from AND :to', {from: params.from, to: params.to})
    .andWhere(params.filters.alertType ? 'sa.alertType = :alertType' : '1=1', {...})
    // tương tự zoneId, status
    .orderBy('sa.triggeredAt', 'DESC')
    .getMany()
  ```
- Lưu ý: `zone` relation trả về row kể cả khi `zone.deletedAt IS NOT NULL` (TypeORM `leftJoinAndSelect` không tự lọc `deletedAt`) — PHẢI filter thủ công ở tầng map dữ liệu (`zone && !zone.deletedAt ? zone.zoneName : 'Toàn khuôn viên'`), mirror cách `AlertsService.findDetail()` đã làm (`alert.zone && !alert.zone.deletedAt ? alert.zone : null`).
- Map sang shape phẳng cho renderer: `{alertType, severity, zoneName, status, triggeredAt, occurrenceCount, acknowledgedByName, acknowledgedAt, resolvedByName, resolvedAt, resolutionNote}`.
- Tính thêm `statusCounts: {new, acknowledged, resolved}` cho phần tổng hợp đầu trang (§5.6 CL-1 — COUNT thuần, không phải suy luận).

### Phase 5: Worker — Render file & Upload & Dispatch

- `SecurityAlertReportWorkerProcessor.processExport(job)`: `markRunning` → `listAllForExport` → render → lưu `media_files` → `markCompleted`.
- **SỬA** `MeetingActivityReportWorkerProcessor.process()`: thêm nhánh `job.name === 'export:security-alert'`.
- `security-alert-pdf-renderer.ts`/`security-alert-xlsx-renderer.ts`: bảng 1 dòng/1 alert + tổng hợp đầu trang (tổng số, phân bổ theo status).

### Phase 6: Seed & Error Handling

- Seed `report.security_alert.export`, gán 3 role.

### Phase 7: Testing

- Unit test validate, tạo job, `listAllForExport` (đặc biệt: `zoneId=null` → "Toàn khuôn viên", zone đã soft-delete → cũng "Toàn khuôn viên" không lộ tên zone đã xóa, `acknowledgedBy`/`resolvedBy` null khi `status='new'`), renderer, worker happy-path/lỗi/rỗng, dispatch đúng job.

### Phase 8: Polish

- Verify KHÔNG sửa `AlertsService`.
- Verify CHỈ 1 `@Processor('report-export')` tồn tại (kiểm tra tổng thể sau khi cả 3 UC Bước 5 đã code).
- Verify KHÔNG có field/logic phân tích suy luận nào ngoài liệt kê + đếm status (BR1 SRS).
- Chạy lại AC ở spec.md §7.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quên filter `deletedAt` khi hiển thị `zone.zoneName` qua `leftJoinAndSelect` (khác pattern raw SQL của UC-127 tự filter trong JOIN) | Lộ tên zone đã bị xóa mềm trong báo cáo — vi phạm CLAUDE.md §5.5 quy tắc 1 | Test case rõ: zone đã soft-delete → báo cáo hiển thị "Toàn khuôn viên", KHÔNG hiển thị tên zone cũ |
| Quên thêm nhánh `job.name==='export:security-alert'` vào processor dùng chung (rủi ro lặp lại lần 3) | Job treo mãi | Test dispatch riêng, mirror UC-127/128 |
| Nếu code sau cùng trong 3 UC, dễ ghi đè/xóa nhầm nhánh dispatch của UC-127/128 khi sửa `process()` | Regression cho 2 báo cáo đã hoạt động trước đó | Đọc kỹ state file trước khi sửa, chỉ THÊM dòng mới, chạy lại toàn bộ test suite `reports` sau khi sửa |
| Field "phân bổ theo status" bị hiểu nhầm là vi phạm BR1 SRS | Tranh cãi phạm vi | Đã ghi rõ lý do (COUNT thuần) ở spec §5.6 CL-1, giữ nguyên trong file |

## Requirements Coverage

| Requirement ID | Task/Phase |
|---|---|
| FR-001–FR-003 | Phase 3 |
| FR-004–FR-007 | Phase 3, Phase 5 |
| FR-008 | Phase 5 |
| FR-009 | Phase 4 |
| FR-010–FR-016 | Phase 2, Phase 3 |
| FR-017 | Phase 3 |
| FR-018–FR-020 | Phase 4 |
| FR-021 | Phase 3 |
