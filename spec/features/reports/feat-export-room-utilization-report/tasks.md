# Tasks: UC-RUM-16 — Xuất báo cáo sử dụng phòng họp

**Feature ID**: RPT-EXPORT-ROOM-UTILIZATION-001
**Module**: `reports`
**Endpoint**: `POST /api/v1/reports/room-utilization/exports`
**Spec**: `spec/features/reports/feat-export-room-utilization-report/spec.md`
**Plan**: `spec/features/reports/feat-export-room-utilization-report/plan.md`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

> Format: `- [ ] TXXX [P] Description with file path`
> `[P]` = có thể chạy song song (khác file, không dependency)

---

## Phase 1: Setup

- [ ] T001 Tạo migration + seed permission `report.room_utilization.export` (gán `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) theo khuôn mẫu `20260703000001-SeedReportMeetingActivityExportPermission.ts`
- [ ] T002 [P] Thêm job name constant `ROOM_UTILIZATION_EXPORT_JOB_NAME = 'export:room-utilization'` vào `src/modules/reports/constants/report-export-job.constants.ts` (sửa file hiện có — thêm constant mới, không đổi constant cũ)

## Phase 2: DTO & Validation Layer

- [ ] T003 [P] Tạo `CreateRoomUtilizationExportDto` trong `src/modules/reports/dto/create-room-utilization-export.dto.ts`: `from`/`to` (@IsDateString), `format` (@IsIn(['pdf','xlsx','csv'])), `scope.roomId` (@IsOptional, @IsUUID, nested), `delivery` (@IsOptional, @IsIn(['download']))
- [ ] T004 [P] Custom validation: `to >= from`, range `<= analytics.dashboard_max_range_days` (FR-016)

## Phase 3: Data Aggregation Layer

**Dependency**: Cần xác nhận tên service thật trong `analytics` (Open Item, `plan.md` mục 4) trước khi bắt đầu.

- [ ] T005 Tạo `RoomUtilizationReportDataService` trong `src/modules/reports/services/room-utilization-report-data.service.ts`: gọi vào `analytics` module lấy `reservationUtilizationRate`/`roomOccupancyRate`/`bookedHours`/`actualHours`/`availableHours` (FR-020, tái dùng nguyên công thức UC-AA-08 — KHÔNG viết lại logic tính)
- [ ] T006 Bổ sung vào `RoomUtilizationReportDataService`: lấy `noShowCount`/`totalBookings`/`noShowRate` (FR-021, tái dùng nguyên công thức UC-AA-09)
- [ ] T007 Bổ sung: breakdown "Actual Usage" theo từng phòng trong scope (FR-022)
- [ ] T008 Bổ sung: query `room_events` cho Phần "Released Rooms" (FR-023, theo `data-model.md` mục 2.1 điều chỉnh cho phần 4-section, không phải CSV)
- [ ] T009 Tạo query riêng cho CSV row-level (`data-model.md` mục 2.2) — JOIN `room_booking_usages`+`room_bookings`+`no_show_cases`+`room_events`, xác nhận lại điều kiện JOIN `room_events` với Open Item ở `plan.md`
- [ ] T010 Method kiểm tra empty-data (FR-017) — `EXISTS` query nhẹ trên `room_bookings`, dùng ở bước tạo job (đồng bộ, KHÔNG trong worker)
- [ ] T011 Unit test `RoomUtilizationReportDataService`: đối chiếu số liệu trả về khớp chính xác với response của các endpoint `analytics` tương ứng cùng filter (kiểm chứng trực tiếp BR1/NFR-006)

## Phase 4: Job Creation Service & Controller

- [ ] T012 Tạo `RoomUtilizationReportService` trong `src/modules/reports/services/room-utilization-report.service.ts`: validate → gọi empty-data check (T010) → nếu rỗng, throw 422 `EMPTY_DATA_SET` → nếu có dữ liệu, `BackgroundJobsService.createQueuedJob()` với `jobType=EXPORT_REPORT`
- [ ] T013 Tạo `RoomUtilizationReportController` trong `src/modules/reports/controllers/room-utilization-report.controller.ts`: `POST reports/room-utilization/exports`, `JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions('report.room_utilization.export')`, trả `202`
- [ ] T014 Đăng ký controller/service mới vào `src/modules/reports/reports.module.ts`
- [ ] T015 Integration test controller: 401/403/400/422 cases (empty-data, validation, permission), happy path 202

## Phase 5: Renderers & Worker

- [ ] T016 [P] Tạo `RoomUtilizationPdfRenderer` trong `src/modules/reports/renderers/room-utilization-pdf-renderer.ts` (`pdfkit`, 4 phần + thông tin chung, bảng/số liệu — không chart ảnh, theo CL-2)
- [ ] T017 [P] Tạo `RoomUtilizationXlsxRenderer` trong `src/modules/reports/renderers/room-utilization-xlsx-renderer.ts` (`exceljs`, sheet/khối theo 4 phần)
- [ ] T018 [P] Tạo `RoomUtilizationCsvRenderer` trong `src/modules/reports/renderers/room-utilization-csv-renderer.ts` (`exceljs.csv.writeBuffer()`, row-level theo T009)
- [ ] T019 Tạo `RoomUtilizationReportWorkerProcessor` trong `src/modules/reports/processors/room-utilization-report-worker.processor.ts`: subscribe job name `export:room-utilization` trong queue `report-export`, `markRunning` → gọi data service (Phase 3) → gọi renderer theo `format` → tạo `media_files` record → `markCompleted`; bắt lỗi → `markFailed`
- [ ] T020 Unit test renderers: kiểm tra output file hợp lệ (đúng số phần/sheet/cột) cho mỗi format
- [ ] T021 Integration test end-to-end: tạo job → xử lý worker (test mode) → `GET /api/v1/background-jobs/:id` trả `completed` + `outputFileId`

## Phase 6: Audit & Documentation Sync

- [ ] T022 Thêm audit log non-blocking `action_type='export_room_utilization_report'` khi tạo job thành công (FR-028)
- [ ] T023 Cập nhật CHANGELOG ở đầu `spec.md`, `plan.md`, `research.md`, `data-model.md`, `tasks.md` sau khi implement xong (RULE TỐI THƯỢNG 2 của CLAUDE.md)
- [ ] T024 [P] Cập nhật `docs/API_CONTRACT_v1.0_with_system_roles.md` nếu team maintain UC-RUM-16 ở đó, tránh tài liệu lệch với code thật
