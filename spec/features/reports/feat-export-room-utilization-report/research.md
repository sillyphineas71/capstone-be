# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới research.md cho UC-RUM-16, tổng hợp phân tích codebase + tham khảo ngành trước khi viết spec.md | Toàn bộ file |

---

# Research: Export Room Utilization Report (UC-RUM-16)

## 1. Codebase Analysis

### Feature song sinh đã ship — khuôn mẫu kiến trúc chính

`capstone-be/src/modules/reports/` đã có **UC-AA-12 (Xuất báo cáo hoạt động cuộc họp)** implement đầy đủ:
- `controllers/meeting-activity-report.controller.ts` — `POST /api/v1/reports/meeting-activity/exports`, `@RequirePermissions('report.meeting_activity.export')`, trả `202 {jobId}`.
- `dto/create-meeting-activity-export.dto.ts` — `from/to/format/scope/delivery`, dùng `class-validator`.
- `services/meeting-activity-report.service.ts` (tạo job) + `meeting-activity-report-data.service.ts` (tổng hợp dữ liệu).
- `processors/meeting-activity-report-worker.processor.ts` — BullMQ worker.
- `renderers/meeting-activity-pdf-renderer.ts` (pdfkit) + `meeting-activity-xlsx-renderer.ts` (exceljs).
- `constants/report-export-job.constants.ts` — `REPORT_EXPORT_QUEUE_NAME = 'report-export'`, `MEETING_ACTIVITY_EXPORT_JOB_NAME = 'export:meeting-activity'`.

Đây là 100% khuôn mẫu cho UC-RUM-16 — chỉ cần thêm 1 bộ controller/dto/service/processor/renderer mới trong cùng `reports` module, tái dùng nguyên `background_jobs`, queue `report-export`, `media_files`, endpoint polling.

### Hạ tầng đã có sẵn, không cần xây lại

- `BackgroundJobsService` (`administration` module): `createQueuedJob/markRunning/markCompleted/markFailed/getJobStatusForUser` — vòng đời job đầy đủ.
- `BackgroundJobType.EXPORT_REPORT` — enum value chung đã tồn tại, tái dùng (không cần thêm giá trị riêng vì `job_type` là `varchar(80)`).
- `queue.module.ts` (Global) đã đăng ký queue `report-export` cùng 8 queue khác — chỉ cần thêm job name mới (`export:room-utilization`) trong cùng queue này.
- `GET /api/v1/background-jobs/:id` — polling endpoint chung, đã hoạt động, đã có authorization (owner hoặc BUSINESS_ADMIN/SYSTEM_ADMIN).

### Nguồn dữ liệu 4 chỉ số — công thức đã có, tái dùng nguyên vẹn

`analytics` module đã implement đầy đủ các dashboard nguồn của 4 chỉ số UC-RUM-16 cần:
- `room-utilization-rate.controller.ts`/`repository.ts` — công thức `reservationUtilizationRate`/`roomOccupancyRate` (UC-AA-08).
- `no-show-rate.controller.ts`/`repository.ts` — công thức `noShowRate` (UC-AA-09).
- `room-usage-dashboard.controller.ts` — `bookedHours`/`actualHours` per-room.

Module `utilization` (`src/modules/utilization/`) chỉ là shell rỗng (`@Module({})`) — toàn bộ logic tính toán thật nằm ở `analytics`, không phải `utilization`. UC-RUM-16 nên gọi vào `analytics` (qua service export, tương tự cách `reports` đã làm với UC-AA-12), KHÔNG chờ đợi hay phụ thuộc module `utilization` được implement.

### "Released rooms" — nguồn dữ liệu xác nhận thật

`room_events.event_type` (varchar tự do, không phải TS enum) đã có sẵn 2 giá trị dùng thật trong code: `'room_auto_released'` và `'room_manual_released'`. Đây chính là nguồn cho Phần "Released Rooms" — không cần tạo bảng/cột mới, chỉ cần query đúng 2 giá trị này.

## 2. Tham khảo thực tế ngành

| Nguồn | Pattern | Áp dụng vào UC-RUM-16 |
|---|---|---|
| **Amazon QuickSight Snapshot Export API** | Export dashboard lớn qua async job (`StartDashboardSnapshotJob`), không xử lý đồng bộ trong request | Xác nhận hướng đi async (background_jobs+BullMQ) là chuẩn ngành cho export dữ liệu dashboard, không phải lựa chọn tuỳ tiện |
| **CSVBox / job-queue pattern cho export lớn** | Enqueue export vào job queue để FE không bị block, hỗ trợ file lớn không giới hạn bởi timeout HTTP | Áp dụng trực tiếp cho CSV (dữ liệu thô, có thể rất nhiều dòng `room_booking_usages`) — lý do chính khiến quyết định D2 (tái dùng async) hợp lý dù Normal Flow đọc như đồng bộ |
| **GoodData Cloud Export Dashboard** | Export phải dùng đúng filter đang áp dụng trên dashboard tại thời điểm export ("what you see is what you get"), tránh hidden state | Xác nhận NFR-006 (không nhận số liệu tính sẵn từ client, luôn tính lại server-side bằng đúng công thức dashboard) là best practice, không phải lựa chọn quá cẩn trọng |
| **ExcelJS vs PDFKit vs Puppeteer** | ExcelJS phù hợp bảng dữ liệu + CSV export (`workbook.csv.writeBuffer()`); PDFKit phù hợp tài liệu có cấu trúc (bảng/số liệu); Puppeteer cần khi PDF phải chứa biểu đồ ảnh thật (HTML→PDF) | UC-RUM-16 dùng lại `exceljs` (Excel + CSV, không cần thêm dependency) và `pdfkit` (PDF dạng bảng/số liệu, không chart ảnh) — nhất quán với renderer đã có của UC-AA-12, tránh thêm Puppeteer (dependency nặng, cần quản lý browser process) trừ khi có yêu cầu rõ ràng về chart ảnh |

## 3. Quyết định kỹ thuật (Technology Decisions)

| Decision | Chọn | Lý do |
|---|---|---|
| Kiến trúc tổng thể | Sao chép khuôn mẫu UC-AA-12 (controller/dto/service/processor/renderer riêng trong `reports`) | Đã có precedent y hệt đã ship — giảm rủi ro thiết kế, nhất quán codebase |
| Nguồn công thức | Gọi vào `analytics` module (không tính lại logic riêng) | NFR-006/BR1 yêu cầu khớp 100% — chỉ đảm bảo được nếu dùng chung 1 tầng tính toán |
| CSV renderer | `exceljs.csv.writeBuffer()` | Không cần thêm dependency mới, cùng lib đã dùng cho Excel |
| PDF renderer | `pdfkit`, dạng bảng/số liệu, không chart ảnh | Nhất quán renderer UC-AA-12, tránh thêm Puppeteer nếu chưa có yêu cầu rõ ràng |
| Empty-data check | Đồng bộ, trước khi tạo job | Tránh tạo job "rác" chỉ để worker fail — query đếm `room_bookings` rất nhẹ, không ảnh hưởng NFR-001 (< 500ms) |
| Permission/actor | Chỉ `BUSINESS_ADMIN`/`SYSTEM_ADMIN` | Đúng Primary Actor literal của UC-RUM-16, khác UC-AA-12 (có Manager) |

## 4. Risks

- **CSV có thể rất lớn** (mỗi `room_booking_usage` = 1 dòng, có thể hàng chục nghìn dòng nếu range dài) — đã giảm thiểu bằng giới hạn `analytics.dashboard_max_range_days` (tái dùng, không tạo giới hạn riêng) và xử lý async không block request.
- **Đồng bộ công thức khi `analytics` module thay đổi formula sau này**: nếu UC-AA-08/09 sửa công thức, UC-RUM-16 phải tự động ăn theo (vì gọi chung service) — không hard-code lại công thức riêng trong `reports`, đúng tinh thần NFR-006.
- **Thiếu chart ảnh thật trong PDF**: Normal Flow bước 4 có nhắc "giữ nguyên biểu đồ" — quyết định hiện tại chỉ làm bảng/số liệu, ghi rõ ở CL-2/Out of Scope để tránh hiểu nhầm là đã đáp ứng đầy đủ yêu cầu UX gốc.
