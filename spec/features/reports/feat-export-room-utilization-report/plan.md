# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới plan.md cho UC-RUM-16 | Toàn bộ file |

---

# Implementation Plan: UC-RUM-16 — Xuất báo cáo sử dụng phòng họp

> **Feature ID**: RPT-EXPORT-ROOM-UTILIZATION-001
> **Module**: `reports` (đọc từ `analytics`, `rooms`)
> **Endpoint**: `POST /api/v1/reports/room-utilization/exports`
> **Permission**: `report.room_utilization.export` (permission mới — cần seed)
> **Spec**: `spec/features/reports/feat-export-room-utilization-report/spec.md`
> **Research**: `spec/features/reports/feat-export-room-utilization-report/research.md`

---

## 1. Feature Summary

UC-RUM-16 cung cấp API `POST /api/v1/reports/room-utilization/exports` — tạo job bất đồng bộ tổng hợp 4 chỉ số vận hành phòng họp (Utilization rate, No-show rate, Actual usage theo phòng, Released rooms) trong 1 khoảng thời gian, sinh file PDF/Excel (cấu trúc 4 phần cố định) hoặc CSV (dữ liệu chi tiết từng dòng `room_booking_usages`). Kiến trúc sao chép gần như nguyên vẹn từ UC-AA-12 đã ship.

---

## 2. Technical Context

### 2.1 Module hiện tại

- `reports` module đã có sẵn `MeetingActivityReportController/Service/Processor/Renderers` cho UC-AA-12 — **không sửa các file này**, chỉ thêm bộ file song song mới cho room-utilization.
- `analytics` module đã có `RoomUtilizationRateService`/`NoShowRateService`/`RoomUsageDashboardService` (tên chính xác cần xác nhận lại khi code, có thể khác tên repository/service) — gọi vào các service này qua export của `AnalyticsModule` (theo đúng doc-comment đã có trong `ReportsModule`: "AnalyticsModule: import để lấy ... KHÔNG import theo cách khác để tránh circular dependency").
- `queue` module (Global) đã đăng ký queue `report-export` — chỉ cần thêm job name mới.

### 2.2 Thành phần cần tạo mới

| File | Vai trò |
|---|---|
| `src/modules/reports/dto/create-room-utilization-export.dto.ts` | Request body DTO: `from/to/format/scope.roomId/delivery` |
| `src/modules/reports/controllers/room-utilization-report.controller.ts` | `POST reports/room-utilization/exports` |
| `src/modules/reports/services/room-utilization-report.service.ts` | Validate, empty-data check (FR-017), tạo job |
| `src/modules/reports/services/room-utilization-report-data.service.ts` | Gọi `analytics` để lấy 4 phần dữ liệu (tái dùng công thức, KHÔNG tính lại) |
| `src/modules/reports/processors/room-utilization-report-worker.processor.ts` | BullMQ worker: `markRunning` → tổng hợp → sinh file → `markCompleted`/`markFailed` |
| `src/modules/reports/renderers/room-utilization-pdf-renderer.ts` | `pdfkit`, cấu trúc 4 phần + thông tin chung |
| `src/modules/reports/renderers/room-utilization-xlsx-renderer.ts` | `exceljs`, sheet/khối tương ứng 4 phần |
| `src/modules/reports/renderers/room-utilization-csv-renderer.ts` | `exceljs.csv.writeBuffer()`, 1 dòng = 1 `room_booking_usage` |
| `src/database/migrations/<timestamp>-SeedReportRoomUtilizationExportPermission.ts` + seed tương ứng | Seed permission `report.room_utilization.export`, gán cho `BUSINESS_ADMIN`/`SYSTEM_ADMIN` (theo đúng khuôn mẫu file migration của `report.meeting_activity.export`) |

### 2.3 Pattern sử dụng

- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('report.room_utilization.export')` ở class-level controller.
- Response tạo job: `{ success, message, data: {jobId, status, delivery, outputFileId}, meta: {} }`, HTTP 202.
- Validation: DTO + `class-validator`.
- Job: `BackgroundJobsService.createQueuedJob({ jobType: BackgroundJobType.EXPORT_REPORT, requestedBy, inputJson })` → enqueue BullMQ job name `export:room-utilization` trong queue `report-export` → worker gọi `markRunning`/`markCompleted`/`markFailed`.

---

## 3. Scope Confirmation

### 3.1 In Scope

- `POST /api/v1/reports/room-utilization/exports` endpoint + DTO.
- Empty-data check đồng bộ trước khi tạo job (FR-017).
- Worker tổng hợp 4 phần (Utilization/No-show/Actual usage/Released rooms) qua gọi `analytics` service, KHÔNG hard-code lại công thức.
- 3 renderer: PDF (bảng/số liệu, không chart ảnh), XLSX (sheet theo phần), CSV (row-level `room_booking_usages`).
- Seed permission mới `report.room_utilization.export`.
- Unit test: happy path, empty-data, permission, validation, đối chiếu công thức khớp `analytics` (BR1).

### 3.2 Out of Scope (theo spec.md mục 8)

- Kênh giao file `email`.
- Truy cập cho role `MANAGER`.
- Chart ảnh thật trong PDF (Puppeteer).
- Filter mở rộng `siteName`/`areaName`/`roomType`.
- Xây lại cơ chế polling — tái dùng `GET /api/v1/background-jobs/:id`.

---

## 4. Open Items cho Code Review

- Xác nhận tên chính xác của các service/method trong `analytics` cần gọi (`RoomUtilizationRateService`, `NoShowRateService`, `RoomUsageDashboardService` hoặc tên tương đương) — spec/research chỉ xác nhận công thức và entity, chưa xác nhận 100% tên class/method thật, cần đối chiếu lại code khi bắt đầu implement.
- Xác nhận cách nối `no_show_cases`/`room_events` với `room_booking_usages` (qua `booking_id`) khi build query CSV (FR-026/FR-027) — cần kiểm tra kỹ FK thật giữa 3 bảng này trước khi viết SQL/QueryBuilder.
