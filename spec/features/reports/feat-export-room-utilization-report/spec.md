# Feature Specification: Xuất báo cáo sử dụng phòng họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo spec lần đầu cho UC-RUM-16 Xuất báo cáo sử dụng phòng họp. Đối chiếu với UC-AA-12 (feature song sinh đã ship) làm khuôn mẫu kiến trúc, liệt kê điểm mơ hồ và chốt 4 quyết định chính (báo cáo tổng hợp cố định 4 phần bất kể dashboard nguồn, tái dùng hạ tầng async của UC-AA-12, CSV = dữ liệu chi tiết từng dòng, Released rooms gộp cả auto + thủ công) trước khi viết spec (xem §0 RECON). | Toàn bộ file |

---

- **Feature ID**: RPT-EXPORT-ROOM-UTILIZATION-001
- **Feature Name**: Xuất báo cáo sử dụng phòng họp (Export Room Utilization Report)
- **Use Case**: UC-RUM-16 Xuất báo cáo sử dụng phòng họp
- **Module / Domain**: `reports` (đọc dữ liệu từ `analytics`, `rooms`)
- **Created Date**: 2026-07-10
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-RUM-16 (actor, trigger, precondition, postcondition, normal flow, exception, business rule)
  - `FE_SmarTracking/src/docs/Copy Uc.md` — mục 11 "Room Utilization Management", dòng 2007-2025 (đối chiếu verbatim — **khớp 100% với bản người dùng cung cấp, không có sai lệch**)
  - `capstone-be/spec/features/reports/feat-export-meeting-activity-report/` (UC-AA-12) — **feature song sinh đã ship**, dùng làm khuôn mẫu kiến trúc (async job qua `background_jobs`+BullMQ+`media_files`, permission pattern, cấu trúc 202+polling)
  - `capstone-be/src/modules/reports/controllers/meeting-activity-report.controller.ts`, `dto/create-meeting-activity-export.dto.ts`, `constants/report-export-job.constants.ts` — code thật đã triển khai cho UC-AA-12, xác nhận queue `report-export` đã đăng ký sẵn trong `queue.module.ts`
  - `capstone-be/spec/features/analytics/feat-view-room-utilization-rate/spec.md` (UC-AA-08) — tái dùng nguyên công thức `reservationUtilizationRate`, `roomOccupancyRate`
  - `capstone-be/spec/features/analytics/feat-view-no-show-rate/spec.md` (UC-AA-09) — tái dùng nguyên công thức `noShowRate`
  - `capstone-be/src/modules/rooms/entities/room-event.entity.ts` — xác nhận `event_type` thực tế có `'room_auto_released'` và `'room_manual_released'`
  - `capstone-be/src/modules/administration/entities/background-job.entity.ts` — xác nhận `BackgroundJobType.EXPORT_REPORT` (giá trị chung, tái dùng, không cần thêm enum value)
  - `CLAUDE.md` mục 19 (Background jobs — liệt kê "Generate report export" là ví dụ dùng `background_jobs`)

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Phạm vi báo cáo — tổng hợp cố định 4 phần, không phụ thuộc dashboard nguồn — đã duyệt

Description liệt kê rõ 4 chỉ số cốt lõi ("đóng gói TOÀN BỘ các chỉ số vận hành cốt lõi—bao gồm: Utilization rate, No-show rate, Actual usage, Released rooms"), nhưng Normal Flow bước 1 mô tả người dùng đang đứng ở MỘT dashboard cụ thể ("Dashboard Tỷ lệ sử dụng hoặc Tỷ lệ No-show") khi bấm Export — có thể đọc thành "chỉ xuất đúng dashboard đang xem". **Quyết định đã duyệt**: báo cáo LUÔN là 1 tài liệu tổng hợp đủ 4 phần (Utilization + No-show + Actual usage + Released rooms), bất kể người dùng bấm Export từ màn hình dashboard nào. 1 endpoint duy nhất, nhất quán với cách UC-AA-12 đã giải quyết đúng loại mơ hồ này (§0.2 của spec đó).

### 0.2. Cơ chế xử lý — tái dùng nguyên hạ tầng async của UC-AA-12 — đã duyệt

Normal Flow mô tả trải nghiệm có vẻ tức thời (loading bar → download ngay), không nhắc tới job/polling — nhưng đây là mô tả UX phía người dùng, không phải ràng buộc kỹ thuật. **Quyết định đã duyệt**: dùng lại nguyên hạ tầng đã ship ở UC-AA-12: `background_jobs` (`job_type='export_report'`, tái dùng `BackgroundJobType.EXPORT_REPORT`) + BullMQ queue `report-export` (đã đăng ký sẵn) + `media_files` lưu output + polling `GET /api/v1/background-jobs/:id` đã có sẵn. FE hiển thị loading bar trong lúc poll ngắn, tự động tải file khi `status='completed'` — trải nghiệm với người dùng vẫn là "tức thời" dù kỹ thuật là async. Tránh timeout HTTP khi CSV chứa dữ liệu thô lớn (§0.3).

### 0.3. Nội dung CSV — dữ liệu chi tiết từng dòng, khác cấu trúc PDF/Excel — đã duyệt

Normal Flow bước 4 mô tả CSV là "dữ liệu thô dung lượng lớn, phục vụ việc import vào hệ thống ERP hoặc Data Warehouse khác" — khác hẳn mục đích PDF/Excel (báo cáo trực quan/bảng KPI). **Quyết định đã duyệt**: CSV xuất **1 dòng = 1 bản ghi `room_booking_usages`** trong phạm vi lọc (không phải 4 con số tổng hợp), gồm đủ field để bên nhận tự tính lại cả 4 chỉ số nếu cần (xem §5.3). PDF/Excel giữ cấu trúc tổng hợp 4 phần theo §0.1.

### 0.4. "Released rooms" — gộp cả auto-release và giải phóng thủ công — đã duyệt

Description không giới hạn nguyên nhân thu hồi phòng. Codebase có 2 nguồn: `room_booking_usages.auto_released=true` (no-show auto-release) và `room_events.event_type='room_manual_released'` (giải phóng thủ công, UC-RUM-12). **Quyết định đã duyệt**: Phần "Released rooms" gộp CẢ HAI, lấy nguồn chính từ `room_events` (`event_type IN ('room_auto_released', 'room_manual_released')`) vì đây là log sự kiện đầy đủ nhất, hữu ích cho mục đích audit mà UC nêu rõ ("hỗ trợ lưu trữ hồ sơ kiểm toán").

### 0.5. Actor — chỉ System Admin/Business Admin, không có Manager — khác UC-AA-12

Primary Actor của UC-RUM-16 chỉ ghi "System Admin, Business Admin" (không có Manager, khác UC-AA-12 vốn cho phép cả Manager giới hạn theo phòng ban). **Quyết định**: tuân thủ đúng literal — không áp dụng logic giới hạn scope theo phòng ban quản lý (department-scoping) như UC-AA-12 đã làm cho Manager. Cả 2 role đều xem toàn công ty theo mặc định, có thể tự nguyện thu hẹp qua filter `scope.roomId` tùy chọn.

### 0.6. Exception E1 khác hành vi UC-AA-12 — không tự ý coi rỗng là hợp lệ

UC-AA-12 (không có Exceptions) coi kết quả rỗng là hợp lệ, sinh file với số liệu = 0 (§0.11 của spec đó). UC-RUM-16 lại **có Exception E1 tường minh**: filter dẫn đến kết quả trống → cảnh báo "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo." — đây KHÔNG phải điểm mơ hồ, UC đã tự quy định rõ, phải tuân thủ đúng, không áp dụng theo pattern UC-AA-12. **Quyết định**: kiểm tra "có dữ liệu hay không" dựa trên việc có tồn tại `room_bookings` overlap `[from,to]` trong scope hay không (nguồn gốc của cả 4 chỉ số) — kiểm tra ĐỒNG BỘ trước khi tạo job (trả lỗi ngay, không tạo job rỗng).

### 0.7. Công thức tái dùng nguyên vẹn từ UC-AA-08/UC-AA-09 (xác nhận field thật)

- `reservationUtilizationRate = bookedHours ÷ availableHours × 100` (1 chữ số thập phân; mẫu số = 0 → trả `0`).
  - `bookedHours` = `SUM(reserved_end_time - reserved_start_time)` từ `room_bookings` với `status IN ('approved','active','completed','released')`.
  - `availableHours` = `operatingHoursPerDay × số_ngày_trong_kỳ × số_phòng_active_trong_scope`, dùng `system_configs['analytics.room_operating_hours_per_day']`.
- `roomOccupancyRate = actualHours ÷ bookedHours × 100` (1 chữ số thập phân; mẫu số = 0 → trả `0`).
  - `actualHours` = ưu tiên `room_booking_usages.actual_end_time - actual_start_time`; fallback `last_presence_at - first_presence_at` nếu thiếu; loại các bản ghi thiếu cả 2 cặp.
- `noShowCount` = đếm `no_show_cases` với `detection_status IN ('confirmed', 'released')` (KHÔNG dùng `resolution_status`).
- `totalBookings` = đếm `room_bookings` với `status IN ('approved','active','completed','released')`, lọc theo `reserved_start_time` trong `[from,to]`.
- `noShowRate = noShowCount ÷ totalBookings × 100` (1 chữ số thập phân; mẫu số = 0 → trả `0`).

### 0.8. Không tạo bảng/enum mới

`background_jobs.job_type` là `varchar(80)`, tái dùng giá trị `EXPORT_REPORT` đã có (không cần thêm enum value như sibling đã làm). `room_events.event_type` là `varchar(60)` tự do, 2 giá trị cần dùng (`room_auto_released`, `room_manual_released`) đã tồn tại thật trong code, không cần thêm. Chỉ cần seed 1 permission mới `report.room_utilization.export` theo đúng khuôn mẫu file migration/seed đã dùng cho `report.meeting_activity.export`.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `reports`, cho phép System Admin/Business Admin trích xuất báo cáo tổng hợp sử dụng phòng họp (PDF/Excel/CSV) trong 1 khoảng thời gian, gồm 4 phần cố định: Tỷ lệ lấp đầy (Utilization), Tỷ lệ vắng mặt (No-show), Số giờ sử dụng thực tế theo từng phòng (Actual usage), và Danh sách phòng bị thu hồi (Released rooms). Xử lý bất đồng bộ qua `background_jobs`+BullMQ (tái dùng nguyên hạ tầng UC-AA-12), tải file qua endpoint polling chung đã tồn tại. Read-only đối với dữ liệu nguồn.

### 1.2 Mục tiêu

Cho phép Business Admin/System Admin cấu hình và khởi tạo job xuất báo cáo sử dụng phòng họp theo khoảng thời gian/phạm vi phòng tùy chọn, nhận file PDF, Excel, hoặc CSV đúng cấu trúc quy chuẩn, khớp 100% với số liệu trên dashboard tại thời điểm xuất (BR1).

### 1.3 Giá trị mang lại

- Phục vụ lưu trữ hồ sơ kiểm toán (audit records) về việc sử dụng tài nguyên phòng họp.
- Chia sẻ số liệu cho các bên liên quan không có tài khoản hệ thống (ban lãnh đạo, đối tác quản lý cơ sở vật chất).
- CSV phục vụ import vào ERP/Data Warehouse nội bộ để phân tích sâu hơn.

### 1.4 Giả định

- Hỗ trợ 3 định dạng `pdf`, `xlsx`, `csv` — đúng Normal Flow bước 4.
- Cấu trúc báo cáo cố định 4 phần (+ 1 phần thông tin chung), không có tùy chỉnh `sections` — §0.1.
- Tái dùng nguyên hạ tầng async `background_jobs`/BullMQ/`media_files`/polling đã có — §0.2.
- Không tạo chart ảnh thực sự trong PDF (giữ nguyên convention `pdfkit` dạng bảng/số liệu có cấu trúc như UC-AA-12, không thêm dependency Puppeteer mới) — quyết định mặc định theo precedent, có thể nâng cấp ở phiên bản sau nếu UX yêu cầu biểu đồ ảnh thật.
- Chỉ hỗ trợ `delivery=download`, không hỗ trợ email — nhất quán UC-AA-12.

### 1.5 Clarifications Resolved

4 quyết định chính đã duyệt: phạm vi tổng hợp cố định 4 phần (§0.1), tái dùng hạ tầng async UC-AA-12 (§0.2), CSV = dữ liệu chi tiết từng dòng (§0.3), Released rooms gộp auto+thủ công (§0.4). Ngoài ra 2 điểm khác biệt quan trọng so với UC-AA-12 đã xác nhận theo đúng literal của UC-RUM-16: actor không có Manager (§0.5), Exception E1 là lỗi thật chứ không phải kết quả rỗng hợp lệ (§0.6).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Business Admin | Quản trị viên doanh nghiệp | Xuất báo cáo toàn công ty hoặc lọc theo `scope.roomId` |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (KHÔNG bao gồm `MANAGER` — §0.5).
- Permission bắt buộc: `report.room_utilization.export` (permission mới — cần seed theo khuôn mẫu file migration/seed của `report.meeting_activity.export`).
- Không có giới hạn scope theo phòng ban — cả 2 role đều xem toàn công ty theo mặc định.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `report.room_utilization.export`.
- Theo dõi job (`GET /api/v1/background-jobs/:id`): tái dùng nguyên authorization đã có (owner hoặc BUSINESS_ADMIN/SYSTEM_ADMIN).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

```text
FR-001: THE system SHALL không tạo/sửa/xóa bất kỳ bản ghi nghiệp vụ nguồn nào (`room_bookings`, `room_booking_usages`, `no_show_cases`, `room_events`) khi sinh báo cáo — chỉ đọc để tổng hợp (POST2).
FR-002: THE system SHALL xử lý yêu cầu xuất báo cáo bất đồng bộ qua `background_jobs` (`job_type='export_report'`), KHÔNG trả file trực tiếp trong response tạo job (§0.2).
FR-003: THE system SHALL tái dùng nguyên `BackgroundJobsService`/endpoint `GET /api/v1/background-jobs/:id` đã có cho việc tạo job và polling trạng thái — không xây route/service mới cho việc này.
```

### 3.2 Event-driven Requirements

```text
FR-004: WHEN người dùng gửi POST /api/v1/reports/room-utilization/exports, THE system SHALL kiểm tra authentication và permission `report.room_utilization.export` trước khi xử lý logic khác.
FR-005: WHEN request hợp lệ VÀ có ít nhất 1 `room_bookings` overlap `[from,to]` trong scope, THE system SHALL tạo 1 `background_jobs` record (`job_type='export_report'`, `status='queued'`, `requested_by=currentUser.id`, `input_json` chứa `{from, to, format, scope, delivery}`) và trả về `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.
FR-006: WHEN worker xử lý job, THE system SHALL đánh dấu `markRunning()`, tổng hợp dữ liệu 4 phần theo §0.7/§3.7, sinh file theo `format`, lưu vào `media_files`, rồi `markCompleted(jobId, {outputFileId, fileName})`.
FR-007: IF worker gặp lỗi trong quá trình tổng hợp/sinh file, THEN THE system SHALL gọi `markFailed(jobId, errorMessage)`, không để job treo ở trạng thái `running`.
```

### 3.3 State-driven Requirements

```text
FR-008: WHILE `scope.roomId` được cung cấp, THE system SHALL giới hạn toàn bộ 4 phần báo cáo (Utilization, No-show, Actual usage, Released rooms) chỉ trong phạm vi phòng đó.
```

### 3.4 Optional Feature Requirements

```text
FR-009: WHERE `scope.roomId` KHÔNG được cung cấp, THE system SHALL tổng hợp báo cáo trên toàn bộ phòng active của công ty.
```

### 3.5 Unwanted Behavior Requirements

```text
FR-010: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.
FR-011: IF người dùng không có permission `report.room_utilization.export`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.
FR-012: IF `from`/`to` thiếu, sai định dạng ISO date, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.
FR-013: IF `format` không thuộc {pdf, xlsx, csv}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.
FR-014: IF `delivery` khác `"download"`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.
FR-015: IF `scope.roomId` không phải UUID hợp lệ hoặc không tồn tại, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.
FR-016: IF khoảng `to - from` vượt `system_configs['analytics.dashboard_max_range_days']`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.
FR-017: IF KHÔNG có bất kỳ `room_bookings` nào overlap `[from,to]` trong scope, THEN THE system SHALL trả về 422, error code `EMPTY_DATA_SET`, message "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo." (Exception E1, §0.6), KHÔNG tạo `background_jobs` record.
```

### 3.6 Authorization Requirements

```text
FR-018: WHEN the user performs a protected action (tạo job xuất báo cáo), THE system SHALL verify authentication và authorization trước khi tạo `background_jobs` record.
```

### 3.7 Data & State Requirements

```text
FR-019: WHEN tổng hợp Phần "Thông tin chung", THE system SHALL bao gồm khoảng thời gian báo cáo, phạm vi (toàn công ty hoặc tên phòng nếu có `scope.roomId`), email người trích xuất, ngày giờ lập báo cáo (thời điểm worker hoàn tất).
FR-020: WHEN tổng hợp Phần "Utilization Rate", THE system SHALL tính đúng `reservationUtilizationRate`, `roomOccupancyRate`, `bookedHours`, `actualHours`, `availableHours` theo công thức tái dùng nguyên vẹn tại §0.7 (nguồn UC-AA-08).
FR-021: WHEN tổng hợp Phần "No-show Rate", THE system SHALL tính đúng `noShowCount`, `totalBookings`, `noShowRate` theo công thức tái dùng nguyên vẹn tại §0.7 (nguồn UC-AA-09).
FR-022: WHEN tổng hợp Phần "Actual Usage", THE system SHALL liệt kê breakdown theo từng phòng trong scope: `roomCode, roomName, bookedHours, actualHours, roomOccupancyRate` (công thức actualHours giống §0.7, áp dụng riêng cho từng phòng).
FR-023: WHEN tổng hợp Phần "Released Rooms", THE system SHALL liệt kê mọi `room_events` với `event_type IN ('room_auto_released', 'room_manual_released')` VÀ `event_time` trong `[from,to]` VÀ room trong scope, gồm `roomCode, roomName, eventType, eventTime, actorUserId (null nếu tự động), oldStatus, newStatus` (§0.4).
FR-024: WHEN sinh file `format=pdf` HOẶC `format=xlsx`, THE system SHALL tổ chức nội dung đúng 4 phần (+ thông tin chung) theo FR-019 → FR-023, KHÔNG chứa dữ liệu row-level thô của `room_booking_usages`.
FR-025: WHEN sinh file `format=csv`, THE system SHALL xuất 1 dòng = 1 bản ghi `room_booking_usages` trong scope + `[from,to]`, gồm các cột: `bookingId, roomCode, roomName, meetingId, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, usageStatus, isNoShow, isReleased, releaseType, releasedAt` (§0.3). KHÔNG tổ chức theo 4 phần như PDF/Excel.
FR-026: WHEN sinh cột `isNoShow` cho mỗi dòng CSV, THE system SHALL đặt `true` nếu tồn tại `no_show_cases` liên kết với `booking_id` đó có `detection_status IN ('confirmed', 'released')`, ngược lại `false`.
FR-027: WHEN sinh cột `isReleased`/`releaseType` cho mỗi dòng CSV, THE system SHALL đặt `isReleased=true` và `releaseType` tương ứng nếu tồn tại `room_events` liên kết có `event_type IN ('room_auto_released', 'room_manual_released')`, ngược lại `isReleased=false`, `releaseType=null`.
```

### 3.8 Notification / Audit Requirements

```text
FR-028: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN job tạo thành công, THE system SHALL ghi audit log non-blocking `action_type='export_room_utilization_report'`, `entity_type='background_jobs'`, `entity_id=jobId`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, format, scope}`.
```

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-RUM-16 POST1/POST2, §0.2 |
| FR-004–FR-007 | Event-driven | UC-RUM-16 Normal Flow bước 3-7 |
| FR-008 | State-driven | UC-RUM-16 Normal Flow bước 2 (filter) |
| FR-009 | Optional Feature | §0.5 |
| FR-010–FR-017 | Unwanted Behavior | UC-RUM-16 E1, validation, §0.6 |
| FR-018 | Authorization | UC-RUM-16 PRE1 |
| FR-019–FR-027 | Data & State | UC-RUM-16 Description, §0.3, §0.4, §0.7 |
| FR-028 | Notification/Audit | Pattern audit đã dùng ở UC-AA-12 |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả về `202` (tạo job) trong vòng dưới 500ms (không tính bước kiểm tra empty-data ở FR-017, vẫn phải đồng bộ nhưng là 1 query đếm nhẹ) — KHÔNG chờ worker xử lý xong trong request.
NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-016) trước khi kiểm tra empty-data hay tạo job.
```

### 4.2 Security

```text
NFR-003: THE system SHALL yêu cầu authentication cho mọi request.
NFR-004: THE system SHALL enforce permission `report.room_utilization.export` ở cả bước tạo job.
```

### 4.3 Reliability & Consistency (BR1 — WYSIWYG)

```text
NFR-005: THE system SHALL đảm bảo job không bao giờ treo vĩnh viễn ở `running` — mọi lỗi phải dẫn đến `failed` (FR-007).
NFR-006: THE system SHALL tính toán số liệu báo cáo bằng CÙNG MỘT tầng service/công thức (§0.7) mà dashboard `analytics` đang dùng để hiển thị trên màn hình — KHÔNG nhận số liệu tính sẵn từ client, KHÔNG dùng công thức khác — đảm bảo BR1 (khớp 100% với những gì hiển thị trên giao diện dựa trên cùng bộ lọc `from/to`/`scope.roomId`).
```

### 4.4 Usability

```text
NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase cho endpoint tạo job.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `background_jobs` | Vòng đời job export | Tái dùng nguyên, `job_type='export_report'` |
| `media_files` | Lưu file PDF/XLSX/CSV output | `background_jobs.output_file_id` trỏ tới đây |
| `room_bookings` | Nguồn `bookedHours`, `totalBookings`, kiểm tra empty-data (FR-017) | `reserved_start_time`, `reserved_end_time`, `status` |
| `room_booking_usages` | Nguồn `actualHours`, dữ liệu chi tiết CSV | `actual_start_time`, `actual_end_time`, `first_presence_at`, `last_presence_at`, `usage_status`, `auto_released` |
| `no_show_cases` | Nguồn `noShowCount`, cột `isNoShow` của CSV | `booking_id`, `detection_status` |
| `room_events` | Nguồn Phần "Released Rooms" | `event_type IN ('room_auto_released','room_manual_released')`, `event_time`, `actor_user_id`, `old_status`, `new_status` |
| `rooms` | Resolve tên phòng, lọc phòng active trong scope | `room_code`, `room_name`, `is_active` |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days`, `analytics.room_operating_hours_per_day` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

**POST /api/v1/reports/room-utilization/exports**

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Có | Bắt đầu kỳ báo cáo | ISO date |
| to | date (ISO 8601) | Có | Kết thúc kỳ báo cáo | ISO date, `to>=from`, range ≤ `analytics.dashboard_max_range_days` |
| format | string | Có | `pdf`/`xlsx`/`csv` | Enum hợp lệ |
| scope.roomId | UUID | Không | Lọc 1 phòng họp cụ thể | UUID hợp lệ, phòng phải tồn tại |
| delivery | string | Không | Mặc định `"download"` | Chỉ chấp nhận `"download"` |

### 5.3 Dữ liệu đầu ra

**Response 202 (tạo job):**

| Field | Type | Mô tả |
|---|---:|---|
| jobId | UUID | ID job vừa tạo |
| status | string | `"queued"` |
| delivery | string | `"download"` |
| outputFileId | null | Luôn `null` khi mới tạo |

**Response 422 (empty data, FR-017):** `{ success: false, message: "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo.", error: { code: "EMPTY_DATA_SET" } }`

**Nội dung file PDF/XLSX (4 phần + thông tin chung — FR-019 → FR-024):**

| Phần | Nội dung |
|---|---|
| 0. Thông tin chung | Kỳ báo cáo, phạm vi, người trích xuất, thời điểm lập |
| 1. Utilization Rate | `reservationUtilizationRate`, `roomOccupancyRate`, `bookedHours`, `actualHours`, `availableHours` |
| 2. No-show Rate | `noShowCount`, `totalBookings`, `noShowRate` |
| 3. Actual Usage (theo phòng) | Bảng: `roomCode, roomName, bookedHours, actualHours, roomOccupancyRate` |
| 4. Released Rooms | Bảng: `roomCode, roomName, eventType, eventTime, actorUserId, oldStatus, newStatus` |

**Nội dung file CSV (FR-025 → FR-027, 1 dòng = 1 `room_booking_usage`):**

`bookingId, roomCode, roomName, meetingId, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, usageStatus, isNoShow, isReleased, releaseType, releasedAt`

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nghiệp vụ nguồn (FR-001).
- Không thêm bảng/cột/enum value mới — chỉ seed 1 permission mới (§0.8).
- File output lưu qua `media_files`, không lưu binary trực tiếp vào `background_jobs`.

### 5.5 Cần làm rõ

- **CL-1**: Filter `scope` hiện chỉ có `roomId` (giữ tối thiểu, đúng những gì xác nhận được từ codebase). Nếu FE cần thêm `siteName`/`areaName`/`roomType` (như các dashboard `analytics` khác đang hỗ trợ), cần bổ sung ở phiên bản sau, không giả định trước trong spec này.
- **CL-2**: Cơ chế render biểu đồ ảnh thật trong PDF (không chỉ bảng số liệu) hiện là Out of Scope (§8) — nếu UX yêu cầu giữ đúng "biểu đồ" như Normal Flow bước 4 mô tả, cần task riêng đánh giá thêm Puppeteer/chart-image dependency.
- **CL-3**: Thư viện sinh CSV cụ thể chưa chọn — `exceljs` đã có sẵn hỗ trợ `workbook.csv.writeBuffer()`, có thể tái dùng không cần thêm dependency mới; quyết định kỹ thuật cụ thể thuộc `plan.md`.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF `from`/`to` thiếu hoặc sai định dạng hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `format` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `delivery` khác `"download"`, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `scope.roomId` không phải UUID hợp lệ hoặc phòng không tồn tại, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.
ERR-006: IF không có `room_bookings` nào trong scope + `[from,to]`, THEN 422 `EMPTY_DATA_SET` (FR-017).
```

### 6.2 Authentication / Authorization Errors

```text
ERR-007: IF chưa đăng nhập, THEN 401.
ERR-008: IF không có permission `report.room_utilization.export`, THEN 403 `PERMISSION_DENIED`.
```

### 6.3 System Errors

```text
ERR-009: IF lỗi tạo `background_jobs` record, THEN 500 `INTERNAL_ERROR`.
ERR-010: IF worker lỗi khi sinh file, THEN job chuyển `failed` với `errorMessage` (không phải lỗi HTTP — client polling sẽ thấy qua `GET /api/v1/background-jobs/:id`).
```

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001:
Given Business Admin đã đăng nhập, có dữ liệu booking trong kỳ báo cáo,
When gọi API với `from/to` hợp lệ, `format=pdf`,
Then hệ thống trả `202 {jobId, status:'queued'}`, sau đó worker hoàn tất và `GET /api/v1/background-jobs/:id` trả `status='completed'`, `outputFileId` khác null.

AC-002:
Given `format=xlsx`,
When job hoàn tất,
Then file output là `.xlsx` hợp lệ, có đủ 4 phần + thông tin chung theo cấu trúc §5.3.

AC-003:
Given `format=csv`,
When job hoàn tất,
Then file output có N dòng tương ứng N bản ghi `room_booking_usages` trong scope, đúng cột theo §5.3, KHÔNG có cấu trúc 4-phần như PDF/Excel.
```

### 7.2 Validation & Authorization Cases

```text
AC-004:
Given không có `room_bookings` nào trong `[from,to]` đã chọn (vd chọn tương lai),
When gọi API,
Then hệ thống reject 422 `EMPTY_DATA_SET`, message "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo." (E1), KHÔNG tạo `background_jobs` record.

AC-005:
Given user có role MANAGER (không phải Business/System Admin),
When gọi API,
Then hệ thống reject 403 `PERMISSION_DENIED` (§0.5 — Manager không có quyền tính năng này).

AC-006:
Given `format="docx"` (không hợp lệ),
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

AC-007:
Given `delivery="email"`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.
```

### 7.3 Business Rule Cases (BR1 — WYSIWYG)

```text
AC-008:
Given dashboard `GET /api/v1/analytics/rooms/utilization-rate` trả `reservationUtilizationRate=72.5` cho cùng `from/to/roomId`,
When export báo cáo PDF/Excel/CSV với đúng filter đó,
Then Phần "Utilization Rate" trong file (hoặc số liệu suy ra được từ CSV) khớp chính xác `72.5` (NFR-006).

AC-009:
Given có 1 phòng bị auto-release do no-show VÀ 1 phòng bị giải phóng thủ công trong kỳ báo cáo,
When tổng hợp Phần "Released Rooms",
Then cả 2 sự kiện đều xuất hiện trong danh sách, phân biệt đúng qua cột `eventType` (§0.4).

AC-010:
Given 1 `room_booking_usages` có liên kết `no_show_cases.detection_status='confirmed'`,
When sinh file CSV,
Then dòng tương ứng có `isNoShow=true` (FR-026).
```

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-006 |
| AC-002 | FR-024 |
| AC-003 | FR-025 |
| AC-004 | FR-017, ERR-006 |
| AC-005 | FR-011, ERR-008 |
| AC-006 | FR-013, ERR-002 |
| AC-007 | FR-014, ERR-003 |
| AC-008 | FR-020, NFR-006 |
| AC-009 | FR-023 |
| AC-010 | FR-026 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Kênh giao file `email` — chỉ `download`.
- `sections` tùy chỉnh — cấu trúc luôn cố định 4 phần + thông tin chung (§0.1).
- Xây lại cơ chế polling/status job — tái dùng nguyên `GET /api/v1/background-jobs/:id` đã có.
- Truy cập tính năng cho role `MANAGER` (§0.5).
- Biểu đồ ảnh thực (chart image) trong PDF — chỉ bảng/số liệu có cấu trúc (CL-2).
- Filter mở rộng `siteName`/`areaName`/`roomType` (CL-1).
- WebSocket push khi job hoàn tất — client polling qua endpoint đã có.

### 8.2 Có thể xem xét ở feature khác

- Biểu đồ ảnh thật trong PDF (Puppeteer/chart renderer) nếu UX yêu cầu (CL-2).
- Mở rộng filter theo site/area/roomType (CL-1).
- Kênh giao file `email` nếu phát sinh yêu cầu sau.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT support delivery values other than "download".
OOS-002: THE system SHALL NOT allow toggling individual report sections via a sections parameter.
OOS-003: THE system SHALL NOT build a new job-status polling endpoint — reuse GET /api/v1/background-jobs/:id.
OOS-004: THE system SHALL NOT grant access to this feature for the MANAGER role.
OOS-005: THE system SHALL NOT create any new database table, column, or enum value for this feature — only a new permission seed.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Notification/Audit.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột/enum database mới (chỉ 1 permission mới).
- [x] Các điểm thiếu thông tin đưa vào mục 5.5 "Cần làm rõ".
