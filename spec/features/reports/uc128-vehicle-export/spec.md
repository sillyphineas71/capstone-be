# Feature Specification: Xuất báo cáo phương tiện

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec lần đầu cho UC-128 Xuất báo cáo phương tiện (Bước 5). Đã đối chiếu SRS chính thức (trang 21-22) + đối chiếu `VehicleRegistrationService`/`VehicleTrafficStatsService` hiện có. 2 điểm mơ hồ đã chốt qua AskUserQuestion trước khi viết spec (xem §0 RECON). | Toàn bộ file |

---

- **Feature ID**: RPT-EXPORT-VEHICLE-001
- **Feature Name**: Xuất báo cáo phương tiện (Export Vehicle Report)
- **Use Case**: UC-128 (SRS chính thức), dựa trên dữ liệu UC-ANPR-04 (đăng ký biển số) + UC-ANPR-07 (= UC-114 thống kê lưu lượng, đã code ở Bước 2)
- **Module / Domain**: reports
- **Created Date**: 2026-07-23
- **Status**: Draft
- **Source Documents**:
  - `SRS-tiếng-Việt-3-pages-2.pdf` trang 21-22 — UC-128 đầy đủ
  - `src/modules/anpr/services/vehicle-registration.service.ts` — nguồn "danh sách đăng ký", hiện CHỈ có `list(userId, query)` scope theo chủ xe, CHƯA có method admin-wide
  - `src/modules/gate-access/services/vehicle-traffic-stats.service.ts` (UC-114) — nguồn "thống kê lưu lượng", đọc `iot_device_events WHERE event_type='ivss_vehicle_event'`
  - `spec/features/reports/uc127-gate-access-export/{spec,plan,tasks}.md` — pattern kiến trúc anh em cùng Bước 5
  - `spec/features/reports/feat-export-meeting-activity-report/*.md` — pattern gốc BullMQ + renderer

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. EX1 "không có dữ liệu" — GIỮ pattern async cũ (đã duyệt, đồng bộ với UC-127/UC-129)

Mirror quyết định §0.1 của `uc127-gate-access-export/spec.md`: LUÔN enqueue job, worker render file "Không có dữ liệu" hợp lệ nếu rỗng. KHÔNG chặn tạo job đồng bộ.

### 0.2. Cần thêm method admin-wide cho "danh sách đăng ký" (đã duyệt)

`VehicleRegistrationService.list(userId, query)` hiện CHỈ trả biển của 1 chủ xe — không phù hợp cho báo cáo Admin/Manager xem TOÀN BỘ. **Quyết định đã duyệt**: viết method mới `listAllForExport(filters)` trong 1 data service riêng của `reports` (KHÔNG sửa `VehicleRegistrationService` hiện có — chỉ đọc thêm qua entity). Phạm vi dữ liệu: **TẤT CẢ trạng thái (active + disabled), LOẠI trừ đã xóa mềm** (`deleted_at IS NOT NULL`) — đúng tinh thần báo cáo đối soát an ninh, Admin cần thấy cả xe đã bị vô hiệu hóa.

### 0.3. Filter "cổng" (zoneId) chỉ áp dụng phần thống kê lưu lượng (đã duyệt)

`vehicle_registrations` KHÔNG có cột `zone_id` (không gắn zone — đây là bảng "ai sở hữu biển số nào", không phải log ra/vào). Chỉ `iot_device_events` (nguồn thống kê lưu lượng UC-114) có `zone_id`. **Quyết định đã duyệt**: khi `content='registrations'` mà vẫn truyền `scope.zoneId`, hệ thống ÂM THẦM BỎ QUA filter đó cho phần registrations (không lỗi). Khi `content='both'`, phần "thống kê lưu lượng" vẫn áp `zoneId` bình thường.

### 0.4. Nội dung báo cáo — 3 lựa chọn `content`

Đúng SRS Normal Flow bước 1: `content IN ('registrations', 'traffic_stats', 'both')`.
- `registrations`: chỉ phần danh sách đăng ký.
- `traffic_stats`: chỉ phần thống kê lưu lượng (tái dùng NGUYÊN `VehicleTrafficStatsService.getStats()` — không viết lại).
- `both`: cả 2 phần trong cùng 1 file (2 section/sheet).

### 0.5. `from`/`to` áp dụng cho cả 2 nguồn, theo cột khác nhau

- Phần "danh sách đăng ký": lọc theo `vehicle_registrations.created_at` (thời điểm đăng ký) — SRS không nói rõ cột nào, nhưng đây là diễn giải hợp lý nhất khi kết hợp UC-ANPR-04 (đăng ký) với 1 khoảng thời gian. Ghi vào §5.6 "Cần làm rõ" — không chặn tiến độ, dùng phương án khuyến nghị này.
- Phần "thống kê lưu lượng": lọc theo `iot_device_events.event_time` (đúng UC-114 `VehicleTrafficStatsService`, không đổi).

### 0.6. Field/entity xác nhận tồn tại thật (không suy đoán)

- `vehicle_registrations`: `id, user_id, plate_raw, plate_number, vehicle_type (nullable), note (nullable), status ('active'/'disabled'), created_at, deleted_at (soft-delete)`.
- `iot_device_events`: nguồn thống kê lưu lượng, `event_type='ivss_vehicle_event'`, `payload_json` chứa `direction/matchState/vehicleType/plateNumber`, có cột `zone_id`.
- `VehicleTrafficStatsService.getStats(query)` trả `{summary, series}` — tái dùng NGUYÊN VẸN, KHÔNG viết lại logic (chỉ gọi qua DI trong worker).
- Không có bảng/cột nào cần thêm. Chỉ seed 1 permission mới `report.vehicle.export`.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `reports`, cho phép Admin/Manager trích xuất báo cáo tổng hợp phương tiện (PDF/Excel): danh sách đăng ký, thống kê lưu lượng, hoặc cả hai. Xử lý bất đồng bộ qua `background_jobs` + BullMQ, tái dùng hạ tầng có sẵn và tái dùng NGUYÊN `VehicleTrafficStatsService` (UC-114) cho phần thống kê.

### 1.2 Mục tiêu

Cho phép Admin/Manager cấu hình và khởi tạo job xuất báo cáo phương tiện theo nội dung/khoảng thời gian/bộ lọc (loại xe, cổng) tùy chọn, phục vụ thống kê định kỳ hoặc đối soát an ninh.

### 1.3 Giá trị mang lại

- Cho Admin: đối soát toàn bộ phương tiện đã đăng ký (kể cả đã vô hiệu hóa) + lưu lượng ra vào.
- Cho Manager: nắm bắt số liệu lưu lượng phương tiện phục vụ vận hành.

### 1.4 Giả định

- LUÔN enqueue job kể cả không có dữ liệu khớp — §0.1.
- `listAllForExport` mới, phạm vi tất cả trạng thái trừ đã xóa mềm — §0.2.
- Filter `zoneId` chỉ có tác dụng với phần thống kê lưu lượng — §0.3.
- `content` có 3 giá trị: `registrations`/`traffic_stats`/`both` — §0.4.
- Chỉ hỗ trợ `format IN ('pdf','xlsx')` (BR1 SRS).

### 1.5 Clarifications Resolved

4 câu hỏi Bước 5 đã chốt qua AskUserQuestion (2026-07-23): EX1 (giữ pattern cũ), phạm vi UC-127 (không liên quan file này), phạm vi "danh sách đăng ký" (tất cả trạng thái trừ xóa mềm), filter cổng (âm thầm bỏ qua khi content=registrations). Áp dụng §0.1–§0.3.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager | Quản lý cấp phòng ban | Xuất báo cáo (SRS không giới hạn scope phòng ban rõ ràng cho UC-128 — xem §2.2) |
| Business Admin / System Admin | Quản trị viên | Xuất báo cáo toàn hệ thống |
| Report Rendering Service | Secondary actor (SRS) | Renderer PDF/XLSX nội bộ |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `report.vehicle.export` (permission mới — cần seed).
- **Không có khái niệm "phòng ban" tự nhiên trên `vehicle_registrations`/lưu lượng phương tiện** (khác UC-127 gắn với `gate_access_logs.user_id → department`) — KHÔNG áp scope phòng ban Manager cho báo cáo này (khác UC-127/UC-AA-12). Manager có quyền xem TOÀN BỘ dữ liệu phương tiện, chỉ giới hạn bởi filter tùy chọn người dùng tự chọn (`vehicleType`, `zoneId`).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `report.vehicle.export`.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL không tạo/sửa/xóa bất kỳ bản ghi nào trong `vehicle_registrations`/`iot_device_events` khi sinh báo cáo — chỉ đọc.

FR-002: THE system SHALL xử lý yêu cầu xuất báo cáo bất đồng bộ qua `background_jobs` + queue `report-export` đã có.

FR-003: THE system SHALL tái dùng nguyên `BackgroundJobsService`/endpoint polling/download đã có.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu POST /api/v1/reports/vehicle/exports, THE system SHALL kiểm tra authentication và permission `report.vehicle.export` trước khi xử lý logic khác.

FR-005: WHEN request hợp lệ, THE system SHALL tạo 1 `background_jobs` record (`input_json` chứa `{from, to, format, content, filters: {vehicleType, zoneId}}`) và trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.

FR-006: WHEN worker xử lý job và `content='registrations'`, THE system SHALL chỉ tổng hợp phần danh sách đăng ký (§3.7).

FR-007: WHEN worker xử lý job và `content='traffic_stats'`, THE system SHALL chỉ gọi `VehicleTrafficStatsService.getStats()` NGUYÊN VẸN (không viết lại logic).

FR-008: WHEN worker xử lý job và `content='both'`, THE system SHALL tổng hợp CẢ HAI phần trong cùng 1 file (2 section/sheet).

FR-009: WHEN worker hoàn tất, THE system SHALL lưu file vào `media_files`, `markCompleted(jobId, {outputFileId, fileName})`.

FR-010: IF worker gặp lỗi, THEN THE system SHALL `markFailed(jobId, errorMessage)`.

### 3.3 State-driven Requirements

FR-011: WHILE tổ hợp filter không có dữ liệu nào khớp (cả 2 phần đều rỗng nếu `content='both'`), THE system SHALL vẫn sinh file hợp lệ ghi "Không có dữ liệu trong khoảng thời gian đã chọn", KHÔNG để job `failed` (§0.1).

### 3.4 Optional Feature Requirements

FR-012: WHERE `filters.vehicleType` được cung cấp, THE system SHALL áp dụng cho CẢ HAI phần (registrations có cột `vehicle_type`, traffic_stats có `payload_json->>'vehicleType'`).

FR-013: WHERE `filters.zoneId` được cung cấp VÀ `content IN ('traffic_stats','both')`, THE system SHALL áp dụng filter cho phần thống kê lưu lượng.

FR-014: WHERE `filters.zoneId` được cung cấp VÀ `content='registrations'`, THE system SHALL ÂM THẦM BỎ QUA filter đó — KHÔNG lỗi (§0.3).

### 3.5 Unwanted Behavior Requirements

FR-015: IF người dùng chưa đăng nhập, THEN 401.

FR-016: IF người dùng không có permission `report.vehicle.export`, THEN 403 `PERMISSION_DENIED`.

FR-017: IF `from`/`to` thiếu, sai định dạng, hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.

FR-018: IF `format` không thuộc `{pdf, xlsx}`, THEN 400 `VALIDATION_ERROR` (BR1 SRS).

FR-019: IF `content` không thuộc `{registrations, traffic_stats, both}`, THEN 400 `VALIDATION_ERROR`.

FR-020: IF `filters.zoneId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.

FR-021: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-022: WHEN the user performs a protected action (tạo job xuất báo cáo), THE system SHALL verify authentication và authorization trước khi tạo `background_jobs` record.

### 3.7 Data & State Requirements

FR-023: WHEN tổng hợp phần "danh sách đăng ký", THE system SHALL truy vấn `vehicle_registrations WHERE deleted_at IS NULL` (§0.2, KHÔNG scope theo userId), JOIN `users` lấy chủ xe (`employeeCode, fullName, email`), lọc `created_at IN [from,to]`, `vehicle_type` (nếu có filter), trả `plateRaw, plateNumber, vehicleType, status, ownerEmployeeCode, ownerFullName, note, createdAt`.

FR-024: WHEN tổng hợp phần "thống kê lưu lượng", THE system SHALL gọi `VehicleTrafficStatsService.getStats({from, to, zoneId, vehicleType})` NGUYÊN VẸN, dùng trực tiếp `{summary, series}` trả về cho renderer.

FR-025: WHEN sinh file với `content='both'`, THE system SHALL tổ chức 2 phần tách biệt rõ ràng (heading/sheet riêng), KHÔNG trộn lẫn dữ liệu 2 nguồn vào cùng 1 bảng.

### 3.8 Notification / Audit Requirements

FR-026: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN job tạo thành công, THE system SHALL ghi audit log non-blocking `action_type='export_vehicle_report'`.

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-128 POST-1, pattern reports module |
| FR-004–FR-010 | Event-driven | UC-128 Normal Flow bước 1-5 |
| FR-011 | State-driven | §0.1 |
| FR-012–FR-014 | Optional Feature | UC-128 Normal Flow bước 1, §0.3 |
| FR-015–FR-021 | Unwanted Behavior | Validation, BR1 |
| FR-022 | Authorization | Pattern chung |
| FR-023–FR-025 | Data & State | §0.2, §0.4, §0.6 |
| FR-026 | Notification/Audit | Pattern chung |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về `202` trong vòng dưới 500ms.

### 4.2 Security

NFR-002: THE system SHALL yêu cầu authentication cho mọi request.

### 4.3 Reliability & Consistency

NFR-003: THE system SHALL đảm bảo job không treo vĩnh viễn ở `running`.

NFR-004: THE system SHALL đảm bảo `VehicleTrafficStatsService.getStats()` được gọi ĐÚNG NGUYÊN chữ ký hiện có, không fork logic (tránh 2 nguồn số liệu lưu lượng khác nhau trong hệ thống).

### 4.4 Usability

NFR-005: THE system SHALL trả về clear error messages, field names camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `vehicle_registrations` | Nguồn "danh sách đăng ký" | Soft-delete, `status IN ('active','disabled')` |
| `iot_device_events` | Nguồn "thống kê lưu lượng" | Qua `VehicleTrafficStatsService.getStats()` nguyên vẹn |
| `users` | Chủ xe | JOIN `vehicle_registrations.user_id` |
| `background_jobs`, `media_files` | Vòng đời job + lưu file | Tái dùng nguyên |

### 5.2 Dữ liệu đầu vào

**POST /api/v1/reports/vehicle/exports**

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Có | Bắt đầu khoảng | ISO date |
| to | date (ISO 8601) | Có | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| format | string | Có | `pdf`/`xlsx` | Enum hợp lệ |
| content | string | Có | `registrations`/`traffic_stats`/`both` | Enum hợp lệ |
| filters.vehicleType | string | Không | Lọc loại xe | Áp dụng cả 2 phần |
| filters.zoneId | UUID | Không | Lọc cổng | Chỉ áp dụng `traffic_stats`/`both` (§0.3) |

### 5.3 Dữ liệu đầu ra

**Response 202:** `{jobId, status:'queued', delivery:'download', outputFileId:null}`.

**Nội dung file:** tùy `content` — 1 hoặc 2 section (§3.7).

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nghiệp vụ nguồn.
- Không thêm bảng/cột mới — chỉ seed 1 permission mới.
- KHÔNG viết lại logic `VehicleTrafficStatsService` — chỉ gọi qua DI.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN worker hoàn tất sinh file, THE system SHALL tạo 1 bản ghi `media_files` mới rồi cập nhật `background_jobs.output_file_id`.

### 5.6 Cần làm rõ

- **CL-1**: Cột thời gian lọc cho phần "danh sách đăng ký" — dùng `created_at` (thời điểm đăng ký) theo khuyến nghị §0.5. Cần xác nhận lại với team nếu ý định thực sự là "biển số đang hoạt động tại thời điểm X" (khác nghĩa với "đăng ký trong khoảng X").
- **CL-2**: SRS không nói rõ Manager có bị giới hạn phạm vi nào cho UC-128 hay không (khác UC-127/UC-AA-12 có khái niệm phòng ban rõ ràng) — §2.2 đã quyết định KHÔNG giới hạn, cần xác nhận lại nếu có yêu cầu khác.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` thiếu/sai/`from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `format` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `content` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `filters.zoneId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `report.vehicle.export`, THEN 403 `PERMISSION_DENIED`.

### 6.3 System Errors

ERR-008: IF lỗi tạo `background_jobs` record, THEN 500 `INTERNAL_ERROR`.
ERR-009: IF worker lỗi khi sinh file, THEN job chuyển `failed` với `errorMessage`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API với `content='both'`, `format=xlsx`,
Then hệ thống trả `202`, worker hoàn tất, file có 2 sheet riêng biệt (đăng ký + lưu lượng).

AC-002:
Given `content='registrations'`, `filters.zoneId` được truyền,
When job hoàn tất,
Then filter `zoneId` bị bỏ qua (không lỗi), danh sách đăng ký trả đầy đủ theo các filter còn lại (§0.3).

AC-003:
Given 1 biển số `status='disabled'`, chưa xóa mềm,
When `content='registrations'`,
Then biển số đó VẪN xuất hiện trong báo cáo (§0.2).

AC-004:
Given 1 biển số đã `deleted_at IS NOT NULL`,
When `content='registrations'`,
Then biển số đó KHÔNG xuất hiện trong báo cáo.

### 7.2 Validation & Authorization Cases

AC-005:
Given `content="invalid"`,
When gọi API,
Then 400 `VALIDATION_ERROR`.

AC-006:
Given `format="docx"`,
When gọi API,
Then 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-007:
Given tổ hợp filter không có dữ liệu nào,
When job hoàn tất,
Then file vẫn sinh hợp lệ ghi "Không có dữ liệu", job KHÔNG `failed`.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-008, FR-025 |
| AC-002 | FR-014 |
| AC-003 | FR-023 |
| AC-004 | FR-023 |
| AC-005 | FR-019, ERR-003 |
| AC-006 | FR-018, ERR-002 |
| AC-007 | FR-011 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Định dạng Word (BR1 SRS).
- Sửa `VehicleRegistrationService`/`VehicleTrafficStatsService` hiện có — chỉ đọc thêm qua data service mới/gọi qua DI.
- Lịch xuất tự động.

### 8.2 Có thể xem xét ở feature khác

- Cột thời gian lọc khác cho "danh sách đăng ký" nếu team xác nhận ý định khác §0.5 (CL-1).
- Giới hạn scope Manager nếu team xác nhận yêu cầu khác §2.2 (CL-2).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT support export format other than pdf/xlsx.
OOS-002: THE system SHALL NOT modify VehicleRegistrationService or VehicleTrafficStatsService — reuse via DI/new read-only data service only.
OOS-003: THE system SHALL NOT apply zoneId filter to the registrations section.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 permission mới).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
