# Feature Specification: Bổ sung API biểu đồ Dashboard SysAdmin (Xu hướng cảnh báo an ninh & Hoạt động audit log theo giờ)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-09 | Tạo spec lần đầu theo yêu cầu `Docs/Nam_Sent/BE_API_REQUIREMENTS_Dashboard_Charts.md` từ FE Team — 2 endpoint aggregate mới cho SysAdmin Dashboard. Đã đối chiếu với FE hiện tại (`FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx`) trước khi viết spec (xem §0 RECON). | Toàn bộ file |

---

- **Feature ID**: AA-DASHBOARD-CHARTS-001
- **Feature Name**: Xem xu hướng cảnh báo an ninh theo ngày & hoạt động audit log theo giờ (Dashboard Chart Data)
- **Module / Domain**: analytics
- **Created Date**: 2026-08-09
- **Status**: Draft
- **Source Documents**:
  - `Docs/Nam_Sent/BE_API_REQUIREMENTS_Dashboard_Charts.md` — tài liệu yêu cầu trực tiếp của FE Team
  - `FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx` — trang Dashboard SysAdmin thực tế đang cần dữ liệu
  - `src/modules/alerts/entities/security-alert.entity.ts`, `src/modules/alerts/dto/create-alert-rule.dto.ts` (ALERT_TYPES)
  - `src/modules/administration/entities/audit-log.entity.ts`
  - `spec/features/analytics/feat-view-meeting-count-by-period/` — tái dùng pattern zero-fill series + audit log non-blocking
  - `CLAUDE.md` mục 5.5 (quy tắc SAVP), mục 8 (response convention)

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã xác nhận

### 0.1. Xác nhận tài liệu FE hợp lệ và nhất quán với code thật

Đã đọc trực tiếp `FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx` và các service `sysAdminServices.js`, `campusService.js`, `securityAlertService.js`: 4/6 API "đã có" trong bảng cuối tài liệu khớp chính xác với code FE đang gọi (`getBusinessAdminSummary`, `getDevices`, `getSecurityAlerts`, `getAdminVehicleTrafficStats`); 2 API còn lại (`getRoomAnalytics`, `getAttendanceAnalytics`) dùng ở trang `bussinessAdmin/dashBoard.jsx` — nhất quán với vai trò dùng chung dashboard analytics. Kết luận: tài liệu là yêu cầu thật, hợp lý, không phải giả định sai.

Ghi nhận 2 điểm lệch phía FE (không thuộc phạm vi feature BE này, chỉ ghi nhận để FE tự xử lý sau khi có API): (a) chưa có placeholder chart nào cho "xu hướng cảnh báo theo ngày"; (b) chart "hoạt động hệ thống theo giờ" hiện tại là line/area chart 6 mốc giờ cứng (mock), khác với BarChart 24 giờ mà tài liệu yêu cầu — đây là việc FE cần làm lại UI, không ảnh hưởng thiết kế API phía BE.

### 0.2. Nguồn dữ liệu xác nhận tồn tại thật

- `security_alerts` ([security-alert.entity.ts](../../../../src/modules/alerts/entities/security-alert.entity.ts)): có `alert_type`, `triggered_at`, `last_seen_at`, `occurrence_count`. **Không soft-delete** (comment entity: "đây là audit trail sự cố an ninh").
- `ALERT_TYPES` ([create-alert-rule.dto.ts](../../../../src/modules/alerts/dto/create-alert-rule.dto.ts)): `'stranger' | 'crowd' | 'vehicle_control_match' | 'intrusion'` — khớp đúng 4 giá trị ví dụ trong tài liệu FE (`intrusion`, `stranger`, `crowd`, `vehicle_control_match`).
- `audit_logs` ([audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)): có `created_at`. Không có cột phân loại action nào bắt buộc phải dùng — tài liệu FE xác nhận rõ "không phân loại action" (§API 2 Notes).
- **Không cần thêm bảng/cột nào.**

### 0.3. Quyết định — đơn vị đếm "cảnh báo theo ngày" dùng `triggered_at`, không dùng `last_seen_at`

`SecurityAlertEntity` có cơ chế dedup: khi 1 alert đang mở tiếp tục xảy ra (cùng loại/zone, còn trong cửa sổ dedup), hệ thống **không tạo bản ghi mới** mà chỉ cập nhật `last_seen_at`/`occurrence_count` trên bản ghi đã có (xem comment entity dòng 23-30). Nếu group theo `last_seen_at`, một alert có thể "nhảy ngày" mỗi lần dedup update, làm sai lệch ngày phát sinh gốc.

**Quyết định**: group theo `triggered_at` (ngày cảnh báo **phát sinh lần đầu**) — phản ánh đúng ngữ nghĩa "số vụ việc an ninh mới phát sinh mỗi ngày", nhất quán với vai trò cột này trong entity.

**Trade-off chấp nhận**: nếu 1 alert kéo dài nhiều ngày liên tục (occurrence lặp lại các ngày sau), các occurrence ở ngày sau **không** được cộng thêm vào `total`/`byType` của ngày đó — chỉ tính 1 lần ở ngày `triggered_at`. Ghi vào §5.8 Cần làm rõ.

### 0.4. Quyết định — không lọc theo `status` của alert

Tài liệu không đề cập lọc theo trạng thái xử lý (`new`/`acknowledged`/`resolved`). Quyết định: đếm **toàn bộ** `security_alerts` bất kể `status`, đúng tinh thần "biểu đồ xu hướng tổng số cảnh báo phát sinh", không phải "cảnh báo đang chờ xử lý" (đã có API riêng `GET /security-alerts?status=new` cho việc đó).

### 0.5. Quyết định — `byType` chỉ liệt kê loại có `count > 0`

Ví dụ trong tài liệu có 1 điểm không nhất quán: ngày đầu tiên liệt kê `"crowd": 0` dù tổng `total=3` đã khớp đủ từ `intrusion:1 + stranger:2` (không cần `crowd:0` để ra tổng đúng); ngày thứ 3 chỉ liệt kê đúng 1 key có giá trị (`vehicle_control_match: 1`), ngày rỗng dùng `{}`. Suy ra hành vi nhất quán thực sự (bỏ qua điểm ngoại lệ dòng đầu) là: **`byType` chỉ chứa các `alert_type` có `count > 0` trong ngày đó**, không liệt kê đủ toàn bộ `ALERT_TYPES` tĩnh với giá trị 0. Ngày không có alert nào → `byType: {}`.

### 0.6. Quyết định — permission riêng cho từng endpoint, theo đúng convention `analytics.<domain>.read`

Repo đã có permission `security_alert.read` (gán `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` — [20260723000006-SeedSecurityAlertPermissions.ts](../../../../src/database/migrations/20260723000006-SeedSecurityAlertPermissions.ts)) và `audit.system.read` (gán riêng `SYSTEM_ADMIN` — [20260703000000-SeedAuditSystemReadPermission.ts](../../../../src/database/migrations/20260703000000-SeedAuditSystemReadPermission.ts)). Tuy nhiên:

- Tài liệu yêu cầu API 1 chỉ cho `SYSTEM_ADMIN, BUSINESS_ADMIN` — **không** có `MANAGER`. Tái dùng thẳng `security_alert.read` sẽ vô tình cấp quyền cho `MANAGER`, sai yêu cầu.
- Toàn bộ endpoint khác trong module `analytics` (`analytics.meeting.read`, `analytics.attendance.read`, `analytics.room.read`...) đều có permission riêng theo namespace `analytics.*`, tách biệt khỏi permission CRUD của module nguồn — giữ cho dashboard analytics bật/tắt độc lập mà không ảnh hưởng trang quản lý gốc.

**Quyết định**: tạo 2 permission mới, seed qua migration (bắt buộc theo CLAUDE.md mục 5.5 quy tắc #4):
- `analytics.security_alerts.read` → `BUSINESS_ADMIN, SYSTEM_ADMIN`.
- `analytics.audit_activity.read` → `SYSTEM_ADMIN` (hành vi cuối cùng tương đương `audit.system.read`, nhưng tách permission để nhất quán convention module `analytics`).

### 0.7. Timezone cố định `Asia/Ho_Chi_Minh` (UTC+7)

Tài liệu ghi rõ "`date` format `YYYY-MM-DD` theo UTC+7" (API 1) — áp dụng nhất quán cho cả 2 API (ranh giới ngày và giờ đều tính theo UTC+7), giống pattern `AT TIME ZONE 'Asia/Ho_Chi_Minh'` đã dùng trong các repository analytics khác (`meeting-count-by-period.repository.ts`, `on-time-rate.repository.ts`).

### 0.8. `days`/`date` mặc định và biên hợp lệ

- API 1: `days` mặc định `7`, hợp lệ `1..30` (đúng tài liệu). Khoảng tính là `[hôm nay - (days-1), hôm nay]` theo UTC+7 (bao gồm hôm nay), sắp xếp tăng dần.
- API 2: `date` mặc định "hôm nay" theo UTC+7, phải đúng định dạng `YYYY-MM-DD`. `buckets` luôn đủ 24 phần tử `00:00..23:00`.

### 0.9. Field/entity xác nhận tồn tại thật

- `SecurityAlertEntity.alertType: string`, `triggeredAt: Date` ([security-alert.entity.ts](../../../../src/modules/alerts/entities/security-alert.entity.ts)).
- `AuditLogEntity.createdAt: Date` ([audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)).
- `AuditLogsService.logAction()` ([audit-logs.service.ts](../../../../src/modules/administration/services/audit-logs.service.ts)) — tái dùng để ghi audit log non-blocking cho hành động xem (đúng pattern `on-time-rate.service.ts`).
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Dashboard SysAdmin (`FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx`) hiện thiếu 2 nguồn dữ liệu tổng hợp phục vụ 2 biểu đồ: xu hướng cảnh báo an ninh 7 ngày gần nhất (LineChart/AreaChart) và tần suất hoạt động hệ thống theo giờ trong ngày (BarChart). Đây là 2 endpoint đọc (read-only), thuộc module `analytics`, không ảnh hưởng tới luồng nghiệp vụ cốt lõi (không block core flow — đúng priority "Medium" trong tài liệu nguồn).

### 1.2 Mục tiêu

Cho phép System Admin (và Business Admin với API 1) xem 2 biểu đồ tổng hợp trên Dashboard: (1) số lượng cảnh báo an ninh theo từng ngày, phân theo loại cảnh báo, trong N ngày gần nhất; (2) số lượng bản ghi audit log theo từng giờ trong 1 ngày cụ thể.

### 1.3 Giá trị mang lại

- Cho System Admin/Business Admin: nhận diện xu hướng tăng/giảm cảnh báo an ninh theo thời gian, phát hiện bất thường.
- Cho System Admin: nhận diện khung giờ hoạt động cao điểm của hệ thống (audit log), hỗ trợ giám sát vận hành.
- Cho vận hành: cả 2 API đều là on-demand aggregation, không cần thêm bảng thống kê định kỳ (không over-engineering).

### 1.4 Giả định

- `series`/`buckets` luôn đủ số phần tử cố định (đủ `days` ngày / đủ 24 giờ), điền `0` cho phần tử không có dữ liệu (đúng Notes của tài liệu nguồn).
- Đếm cảnh báo theo `triggered_at` (§0.3), không cross-check `last_seen_at`/`occurrence_count`.
- Không lọc theo `status` alert (§0.4), không lọc theo `action_type` audit log (đúng tài liệu: "không phân loại action").
- `byType` chỉ liệt kê alert type có `count > 0` (§0.5).
- Timezone tính toán cố định `Asia/Ho_Chi_Minh` (UTC+7).

### 1.5 Cần làm rõ

- Xem §5.8.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| System Admin | Quản trị viên hệ thống | Xem cả 2 API (daily-trend + hourly) |
| Business Admin | Quản trị viên doanh nghiệp | Chỉ xem API 1 (daily-trend), không có quyền API 2 |

### 2.2 Role & Permission Rules

- API 1 (`GET /analytics/security-alerts/daily-trend`): yêu cầu permission `analytics.security_alerts.read`, gán cho `role_code IN (BUSINESS_ADMIN, SYSTEM_ADMIN)`.
- API 2 (`GET /analytics/audit-activity/hourly`): yêu cầu permission `analytics.audit_activity.read`, gán duy nhất `role_code = SYSTEM_ADMIN`.
- Không có scope theo phòng ban/zone — cả 2 API là dữ liệu toàn hệ thống (đúng tính chất dashboard SysAdmin, khác các API scope theo Manager ở feature khác).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập (JWT hợp lệ) và có đúng permission tương ứng từng endpoint.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu ở dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `security_alerts` hoặc `audit_logs`.

FR-002: THE system SHALL tính toán lại `series`/`buckets` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API, không cache/pre-aggregate.

FR-003: THE system SHALL đếm `security_alerts` theo `triggered_at` (ngày phát sinh lần đầu), không dùng `last_seen_at` (§0.3).

FR-004: THE system SHALL đếm toàn bộ `security_alerts` bất kể `status` xử lý, và toàn bộ `audit_logs` bất kể `action_type`/`severity` (§0.4).

### 3.2 Event-driven Requirements

FR-005: WHEN người dùng gửi yêu cầu `GET /analytics/security-alerts/daily-trend`, THE system SHALL kiểm tra authentication và permission `analytics.security_alerts.read` trước khi xử lý logic khác.

FR-006: WHEN người dùng gửi yêu cầu `GET /analytics/audit-activity/hourly`, THE system SHALL kiểm tra authentication và permission `analytics.audit_activity.read` trước khi xử lý logic khác.

FR-007: WHEN người dùng không truyền `days`, THE system SHALL áp dụng mặc định `days=7`.

FR-008: WHEN người dùng truyền `days` hợp lệ trong khoảng `1..30`, THE system SHALL tính `series` cho đúng `days` ngày gần nhất tính đến hôm nay (bao gồm hôm nay), theo timezone `Asia/Ho_Chi_Minh`.

FR-009: WHEN người dùng không truyền `date` cho API 2, THE system SHALL áp dụng mặc định là ngày hiện tại theo timezone `Asia/Ho_Chi_Minh`.

FR-010: WHEN người dùng truyền `date` hợp lệ (`YYYY-MM-DD`) cho API 2, THE system SHALL tính `buckets` cho đúng ngày đó theo timezone `Asia/Ho_Chi_Minh`.

### 3.3 State-driven Requirements

FR-011: WHILE một ngày trong khoảng `days` không có `security_alerts` nào phát sinh, THE system SHALL trả về phần tử `series` của ngày đó với `total=0`, `byType={}`.

FR-012: WHILE một giờ trong ngày được truy vấn không có `audit_logs` nào, THE system SHALL trả về phần tử `buckets` của giờ đó với `count=0`.

### 3.4 Optional Feature Requirements

_Không áp dụng — feature này không có optional feature/config flag nào (không có filter tùy chọn ngoài `days`/`date`)._

### 3.5 Unwanted Behavior Requirements

FR-013: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-014: IF người dùng không có permission tương ứng endpoint đang gọi, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-015: IF `days` không phải số nguyên trong khoảng `1..30`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-016: IF `date` không đúng định dạng `YYYY-MM-DD` hoặc không phải ngày hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

### 3.6 Authorization Requirements

FR-017: WHEN người dùng thực hiện một trong hai action đọc dữ liệu này, THE system SHALL xác thực authentication và authorization trước khi chạy truy vấn tổng hợp.

### 3.7 Data & State Requirements

FR-018: WHEN tính `series` cho API 1, THE system SHALL nhóm `security_alerts` theo ngày (`triggered_at` tại UTC+7) và theo `alert_type`, trả đủ `days` phần tử theo thứ tự thời gian tăng dần.

FR-019: WHEN tính `totalInPeriod` cho API 1, THE system SHALL lấy tổng `total` của toàn bộ phần tử `series` (đảm bảo khớp NFR-005-style consistency).

FR-020: WHEN tính `buckets` cho API 2, THE system SHALL nhóm `audit_logs` theo giờ (`created_at` tại UTC+7) trong đúng ngày `date`, trả đủ 24 phần tử `00:00..23:00` theo thứ tự tăng dần.

FR-021: WHEN tính `totalToday` cho API 2, THE system SHALL lấy tổng `count` của toàn bộ phần tử `buckets`.

FR-022: WHEN xây dựng `byType` cho một ngày, THE system SHALL chỉ liệt kê các `alert_type` có `count > 0` trong ngày đó (§0.5).

### 3.8 Notification / Audit Requirements

FR-023: WHEN một trong hai API hoàn tất thành công, THE system SHALL ghi audit log non-blocking (`action_type='read_analytics_security_alerts_daily_trend'` hoặc `'read_analytics_audit_activity_hourly'`, `entity_type` tương ứng `security_alerts`/`audit_logs`) chứa tối thiểu `{viewerUserId, viewerRole, days hoặc date, totalInPeriod hoặc totalToday}`.

FR-024: IF việc ghi audit log thất bại, THEN THE system SHALL vẫn trả về kết quả API bình thường cho client (audit log không được chặn response chính — đúng pattern `on-time-rate.service.ts`).

### 3.9 Complex / Combined Requirements

FR-025: WHILE tổng số `security_alerts`/`audit_logs` trong toàn bộ khoảng truy vấn bằng 0, IF client vẫn gọi API, THEN THE system SHALL vẫn trả về đủ số phần tử `series`/`buckets` (không rút gọn thành mảng rỗng), tổng `totalInPeriod`/`totalToday=0`.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-004 | Ubiquitous | Tài liệu FE §API 1/2 Notes, §0.3, §0.4 |
| FR-005–FR-010 | Event-driven | Tài liệu FE §API 1/2 Query Parameters |
| FR-011, FR-012 | State-driven | Tài liệu FE Notes "luôn trả đủ phần tử" |
| FR-013–FR-016 | Unwanted Behavior | Validation chuẩn repo |
| FR-017 | Authorization | Tài liệu FE §Auth |
| FR-018–FR-022 | Data & State | Tài liệu FE Response mẫu, §0.3, §0.5 |
| FR-023, FR-024 | Notification/Audit | Pattern đã dùng ở UC-AA-04/UC-AA-10 |
| FR-025 | Complex | Tài liệu FE Notes zero-fill |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho `days<=30` hoặc 1 ngày `buckets` trong điều kiện tải bình thường.

### 4.2 Security

NFR-002: THE system SHALL yêu cầu authentication cho mọi request.

NFR-003: THE system SHALL enforce permission theo đúng role đã seed (§2.2) — không dựa vào FE để chặn truy cập.

### 4.3 Reliability & Consistency

NFR-004: THE system SHALL đảm bảo `totalInPeriod = SUM(series[].total)` và `totalToday = SUM(buckets[].count)` trong mọi response.

NFR-005: THE system SHALL sử dụng index sẵn có trên `security_alerts(triggered_at)`/`audit_logs(created_at)` nếu có, hoặc quét trong phạm vi giới hạn (`days<=30`, 1 ngày) để tránh full scan không kiểm soát.

### 4.4 Usability

NFR-006: THE system SHALL trả về field names dạng camelCase, format response chuẩn `{success, message, data, meta}` (CLAUDE.md mục 8.1).

### 4.5 Observability

NFR-007: THE system SHALL ghi log lỗi xử lý quan trọng (query thất bại) qua Nest Logger chuẩn của module.

### 4.6 Maintainability

NFR-008: THE system SHALL đặt 2 endpoint này trong module `analytics` hiện có, tái sử dụng guard/decorator/response convention sẵn có, không tạo module mới.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `security_alerts` | Nguồn dữ liệu API 1 | Đọc `alert_type`, `triggered_at`. Không soft-delete. |
| `audit_logs` | Nguồn dữ liệu API 2 | Đọc `created_at`. Không lọc theo `action_type`/`severity`. |
| `permissions`, `role_permissions`, `roles` | Seed 2 permission mới | Migration, không tạo bảng mới |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| days (API 1) | integer | Không | Số ngày lấy dữ liệu | Mặc định 7; khoảng hợp lệ 1..30 |
| date (API 2) | string (`YYYY-MM-DD`) | Không | Ngày thống kê | Mặc định hôm nay (UTC+7); phải là ngày hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| series[].date | string (`YYYY-MM-DD`) | Ngày (UTC+7) |
| series[].total | integer | Tổng số alert phát sinh (`triggered_at`) trong ngày |
| series[].byType | object | `{ [alertType]: count }`, chỉ liệt kê type có count > 0 (§0.5) |
| totalInPeriod | integer | Tổng `series[].total` |
| date (API 2) | string (`YYYY-MM-DD`) | Ngày được thống kê |
| buckets[].hour | string (`HH:00`) | Giờ trong ngày (UTC+7), 00..23 |
| buckets[].count | integer | Số audit log trong giờ đó |
| totalToday | integer | Tổng `buckets[].count` |

### 5.4 State / Status Model

_Không áp dụng — tính năng không có state machine, chỉ là read aggregation._

### 5.5 Data Constraints

- Không ghi/sửa/xóa `security_alerts`/`audit_logs`.
- Không thêm bảng/cột nào — chỉ thêm 2 dòng `permissions` + role mapping qua migration.
- `series` luôn đủ đúng `days` phần tử; `buckets` luôn đủ đúng 24 phần tử.
- `totalInPeriod = SUM(series[].total)`; `totalToday = SUM(buckets[].count)`.

### 5.6 Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request (on-demand aggregation), không cache.

### 5.7 Data-related EARS Requirements

FR-DATA-001: WHEN nhóm `security_alerts` theo ngày, THE system SHALL dùng biểu thức `(triggered_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` làm khóa nhóm.

FR-DATA-002: WHEN nhóm `audit_logs` theo giờ, THE system SHALL dùng biểu thức `EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')` làm khóa nhóm, giới hạn trong đúng ngày `date` (cũng tính theo UTC+7).

### 5.8 Cần làm rõ

- **CL-1**: Trade-off ở §0.3 — alert kéo dài nhiều ngày (occurrence lặp lại) chỉ được tính 1 lần vào ngày `triggered_at`, không cộng dồn vào các ngày sau dù `last_seen_at` rơi vào ngày đó. Nếu về sau cần phản ánh "hoạt động đang diễn ra" theo từng ngày, cần thiết kế lại (ví dụ bảng log occurrence riêng) — ngoài phạm vi feature này.
- **CL-2**: Điểm không nhất quán trong ví dụ response của tài liệu nguồn (`crowd: 0` ở ngày đầu) đã được diễn giải theo hướng nhất quán nhất (§0.5) — cần FE xác nhận lại cách hiển thị nếu có sai khác thực tế khi tích hợp.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `days` không phải số nguyên trong khoảng `1..30`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `date` sai định dạng `YYYY-MM-DD` hoặc không phải ngày hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-003: IF chưa đăng nhập, THEN 401.
ERR-004: IF không có permission `analytics.security_alerts.read` (API 1) hoặc `analytics.audit_activity.read` (API 2), THEN 403 `PERMISSION_DENIED`.

### 6.3 System Errors

ERR-005: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập và có permission `analytics.security_alerts.read`,
When gọi `GET /analytics/security-alerts/daily-trend` không truyền `days`,
Then hệ thống trả về `series` đủ 7 phần tử (7 ngày gần nhất tính đến hôm nay), `totalInPeriod` bằng tổng `series[].total`.

AC-002:
Given System Admin đã đăng nhập và có permission `analytics.audit_activity.read`,
When gọi `GET /analytics/audit-activity/hourly` không truyền `date`,
Then hệ thống trả về `buckets` đủ 24 phần tử cho ngày hôm nay, `totalToday` bằng tổng `buckets[].count`.

AC-003:
Given tồn tại 1 alert `intrusion` và 2 alert `stranger` có `triggered_at` cùng 1 ngày trong khoảng lọc,
When gọi API 1,
Then phần tử `series` của ngày đó có `total=3`, `byType={"intrusion":1,"stranger":2}` (không có key `crowd`).

### 7.2 Validation Cases

AC-004:
Given `days=31` (vượt giới hạn),
When gọi API 1,
Then hệ thống reject 400 `VALIDATION_ERROR`.

AC-005:
Given `date="2026-13-99"` (không hợp lệ),
When gọi API 2,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Authorization Cases

AC-006:
Given người dùng có role `MANAGER` (không có permission `analytics.security_alerts.read`),
When gọi API 1,
Then hệ thống reject 403 `PERMISSION_DENIED`.

AC-007:
Given Business Admin (không có permission `analytics.audit_activity.read`),
When gọi API 2,
Then hệ thống reject 403 `PERMISSION_DENIED`.

### 7.4 Business Rule Cases

AC-008:
Given không có `security_alerts` nào phát sinh trong toàn bộ khoảng `days`,
When gọi API 1,
Then `series` đủ `days` phần tử với `total=0, byType={}` mỗi phần tử, `totalInPeriod=0`.

AC-009:
Given không có `audit_logs` nào trong ngày `date`,
When gọi API 2,
Then `buckets` đủ 24 phần tử với `count=0`, `totalToday=0`.

### 7.5 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-007, FR-008, FR-018, FR-019 |
| AC-002 | FR-009, FR-020, FR-021 |
| AC-003 | FR-003, FR-018, FR-022 |
| AC-004 | FR-015, ERR-001 |
| AC-005 | FR-016, ERR-002 |
| AC-006 | FR-014, ERR-004 |
| AC-007 | FR-014, ERR-004 |
| AC-008 | FR-011, FR-025 |
| AC-009 | FR-012, FR-025 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Không sửa/tái cấu trúc UI biểu đồ phía FE (đã ghi nhận 2 điểm lệch FE ở §0.1 — thuộc trách nhiệm FE).
- Không lọc theo `status` alert hoặc `action_type`/`severity` audit log (§0.4).
- Không cache/pre-aggregate kết quả (bảng thống kê định kỳ, cron job) — luôn tính on-demand.
- Không cộng dồn occurrence của alert đang mở vào các ngày sau `triggered_at` (§0.3, CL-1).
- Không thêm bảng/cột database mới.
- Không thay đổi 6 API "đã có" liệt kê trong tài liệu nguồn.

### 8.2 Có thể xem xét ở feature khác

- Thiết kế lại cách tính "hoạt động đang diễn ra theo ngày" nếu CL-1 phát sinh vấn đề thực tế.
- Đồng bộ lại ví dụ response trong tài liệu FE gốc để khớp chính xác §0.5.
- FE dựng lại chart "hoạt động hệ thống theo giờ" từ line/area 6 mốc sang BarChart 24 giờ.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT create new database tables, columns, or pre-aggregation jobs for this feature.
OOS-002: THE system SHALL NOT filter security_alerts by status or audit_logs by action_type/severity in these 2 endpoints.
OOS-003: THE system SHALL NOT attribute repeated (deduplicated) alert occurrences to any day other than the alert's triggered_at day.
OOS-004: THE system SHALL NOT modify any of the 6 existing dashboard endpoints listed as "already available" in the source document.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ các pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới.
- [x] Các điểm thiếu thông tin đưa vào mục 5.8 "Cần làm rõ".
- [x] Đã xác nhận field/entity/enum bằng cách đọc trực tiếp source code, không suy đoán.
- [x] Đã đối chiếu tài liệu nguồn với FE code thật trước khi viết spec (§0.1).
