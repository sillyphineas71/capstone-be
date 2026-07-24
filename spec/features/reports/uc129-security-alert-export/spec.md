# Feature Specification: Xuất báo cáo sự kiện an ninh

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec lần đầu cho UC-129 Xuất báo cáo sự kiện an ninh (Bước 5). Đã đối chiếu SRS chính thức (trang 22-23) + đối chiếu `AlertsService`/`SecurityAlertEntity` (Bước 3) hiện có. 1 điểm mơ hồ chốt qua AskUserQuestion chung với UC-127/128 (EX1 giữ pattern cũ). | Toàn bộ file |

---

- **Feature ID**: RPT-EXPORT-SECURITY-ALERT-001
- **Feature Name**: Xuất báo cáo sự kiện an ninh (Export Security Alert Report)
- **Use Case**: UC-129 (SRS chính thức), dựa trên dữ liệu UC-SEC-02 (= UC-123 API trung tâm cảnh báo, đã code ở Bước 3)
- **Module / Domain**: reports
- **Created Date**: 2026-07-23
- **Status**: Draft
- **Source Documents**:
  - `SRS-tiếng-Việt-3-pages-2.pdf` trang 22-23 — UC-129 đầy đủ
  - `src/modules/alerts/services/alerts.service.ts` — `list()` (phân trang, dùng cho UI trung tâm cảnh báo) + `findDetail()` (JOIN zone/sourceEvent/rule) — CẢ HAI chưa phù hợp trực tiếp cho export (cần không phân trang + JOIN người xử lý)
  - `src/modules/alerts/entities/security-alert.entity.ts` — xác nhận field thật: `alertType, severity, zoneId, status, triggeredAt, lastSeenAt, occurrenceCount, acknowledgedBy/At, resolvedBy/At, resolutionNote`
  - `spec/features/reports/uc127-gate-access-export/*.md`, `uc128-vehicle-export/*.md` — pattern kiến trúc anh em cùng Bước 5

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. EX1 "không có dữ liệu" — GIỮ pattern async cũ (đã duyệt, đồng bộ với UC-127/UC-128)

Mirror §0.1 của 2 spec anh em: LUÔN enqueue job, worker render file "Không có dữ liệu" hợp lệ nếu rỗng.

### 0.2. Không phân trang cho export — viết data service riêng

`AlertsService.list()` có phân trang (`page/limit`) — phù hợp cho UI, KHÔNG phù hợp cho file export (cần TOÀN BỘ dữ liệu khớp filter). **Quyết định**: viết `SecurityAlertExportDataService.listAllForExport(filters)` riêng trong `reports`, KHÔNG sửa `AlertsService.list()` — chỉ đọc thêm qua entity, JOIN `zones`/`users` (2 lần cho `acknowledgedByUser`/`resolvedByUser`) để có đủ "người xử lý" theo yêu cầu POST-1 SRS.

### 0.3. Không giới hạn số dòng — cảnh báo an ninh nhạy cảm hơn báo cáo khác, cân nhắc soft-cap

Khác UC-127 (đã quyết không giới hạn), UC-129 có khả năng dữ liệu rất lớn nếu khoảng thời gian dài (mỗi sự kiện lặp lại KHÔNG tạo dòng mới — nhờ cơ chế `recordAlert()` dedup/bump `occurrence_count`, Bước 3 — nên số dòng thực tế bị chặn tự nhiên bởi số lượng alert MỞ+ĐÃ ĐÓNG duy nhất, không phải số lần vi phạm). **Quyết định**: KHÔNG giới hạn số dòng cứng ở tầng data service (nhất quán UC-127/UC-AA-12 Phần 4) — dựa vào `analytics.dashboard_max_range_days` để chặn khoảng thời gian quá dài từ tầng validate.

### 0.4. Field/entity xác nhận tồn tại thật (không suy đoán)

- `security_alerts`: `id, alertType, severity, zoneId (nullable), status ('new'/'acknowledged'/'resolved'), triggeredAt, lastSeenAt, occurrenceCount, sourceEventId (nullable), ruleId (nullable), payloadJson, acknowledgedBy/At, resolvedBy/At, resolutionNote`. KHÔNG soft-delete (audit trail).
- JOIN `zones z ON z.id = sa.zone_id AND z.deleted_at IS NULL` (CLAUDE.md §5.5 quy tắc 1) — cảnh báo `zoneId=null` (global, không gắn zone cụ thể) là hợp lệ, hiển thị "Toàn khuôn viên".
- JOIN `users` 2 lần (`acknowledgedByUser`, `resolvedByUser`) lấy `fullName`/`email` — cả 2 nullable (alert `status='new'` chưa có người xử lý nào).
- Không có bảng/cột nào cần thêm. Chỉ seed 1 permission mới `report.security_alert.export`.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `reports`, cho phép Admin/Manager trích xuất báo cáo tổng hợp các cảnh báo/sự kiện an ninh đã ghi nhận tại `security_alerts` (Bước 3) ra PDF/Excel, theo bộ lọc loại cảnh báo/khu vực/trạng thái xử lý, phục vụ tổng kết định kỳ hoặc điều tra sự cố.

### 1.2 Mục tiêu

Cho phép Admin/Manager cấu hình và khởi tạo job xuất báo cáo sự kiện an ninh, nhận file liệt kê từng cảnh báo kèm trạng thái xử lý, người xử lý, ghi chú.

### 1.3 Giá trị mang lại

- Cho Admin an ninh: tổng kết định kỳ, điều tra sự cố, phục vụ audit trách nhiệm xử lý (ai đã acknowledge/resolve, khi nào).

### 1.4 Giả định

- LUÔN enqueue job kể cả không có dữ liệu khớp — §0.1.
- Không phân trang, không giới hạn số dòng cứng — §0.2, §0.3.
- Chỉ hỗ trợ `format IN ('pdf','xlsx')` (BR1 SRS, ngầm định — SRS UC-129 không viết BR1 riêng nhưng nhất quán UC-127/128).

### 1.5 Clarifications Resolved

1 câu hỏi chung Bước 5 áp dụng file này: EX1 giữ pattern cũ (§0.1). Không có điểm mơ hồ nghiệp vụ riêng nào khác cần AskUserQuestion cho UC-129 — cấu trúc dữ liệu nguồn (`security_alerts`) đã rõ ràng, đã có sẵn từ Bước 3.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager | Quản lý cấp phòng ban | Xuất báo cáo (không có khái niệm phòng ban tự nhiên trên `security_alerts` — xem §2.2) |
| Business Admin / System Admin | Quản trị viên an ninh | Xuất báo cáo toàn khuôn viên |
| Report Rendering Service | Secondary actor (SRS) | Renderer PDF/XLSX nội bộ |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `report.security_alert.export` (permission mới — cần seed).
- **Không áp scope phòng ban** cho báo cáo này (mirror quyết định §2.2 của UC-128 — `security_alerts` không gắn `department_id`, chỉ gắn `zone_id`). Bộ lọc `zoneId` là filter tùy chọn cho MỌI role, không phải cơ chế phân quyền.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `report.security_alert.export`.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL không tạo/sửa/xóa bất kỳ bản ghi nào trong `security_alerts` khi sinh báo cáo — chỉ đọc (BR1 SRS: "không tự tạo thêm phân tích/suy luận nào ngoài dữ liệu đã có").

FR-002: THE system SHALL xử lý yêu cầu xuất báo cáo bất đồng bộ qua `background_jobs` + queue `report-export` đã có.

FR-003: THE system SHALL tái dùng nguyên `BackgroundJobsService`/endpoint polling/download đã có.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu POST /api/v1/reports/security-alert/exports, THE system SHALL kiểm tra authentication và permission `report.security_alert.export` trước khi xử lý logic khác.

FR-005: WHEN request hợp lệ, THE system SHALL tạo 1 `background_jobs` record (`input_json` chứa `{from, to, format, filters: {alertType, zoneId, status}}`) và trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.

FR-006: WHEN worker xử lý job, THE system SHALL `markRunning()`, gọi `SecurityAlertExportDataService.listAllForExport()` (§3.7), sinh file theo `format`, lưu vào `media_files`, `markCompleted(jobId, {outputFileId, fileName})`.

FR-007: IF worker gặp lỗi, THEN THE system SHALL `markFailed(jobId, errorMessage)`.

### 3.3 State-driven Requirements

FR-008: WHILE tổ hợp filter không có `security_alerts` nào khớp `[from,to]` (theo `triggeredAt`) + filter, THE system SHALL vẫn sinh file hợp lệ ghi "Không có dữ liệu trong khoảng thời gian đã chọn", KHÔNG để job `failed` (§0.1).

### 3.4 Optional Feature Requirements

FR-009: WHERE `filters.alertType`/`filters.zoneId`/`filters.status` được cung cấp, THE system SHALL áp dụng như filter bổ sung (mirror điều kiện của `AlertsService.list()`).

### 3.5 Unwanted Behavior Requirements

FR-010: IF người dùng chưa đăng nhập, THEN 401.

FR-011: IF người dùng không có permission `report.security_alert.export`, THEN 403 `PERMISSION_DENIED`.

FR-012: IF `from`/`to` thiếu, sai định dạng, hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.

FR-013: IF `format` không thuộc `{pdf, xlsx}`, THEN 400 `VALIDATION_ERROR`.

FR-014: IF `filters.zoneId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.

FR-015: IF `filters.status` không thuộc `{new, acknowledged, resolved}`, THEN 400 `VALIDATION_ERROR`.

FR-016: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-017: WHEN the user performs a protected action (tạo job xuất báo cáo), THE system SHALL verify authentication và authorization trước khi tạo `background_jobs` record.

### 3.7 Data & State Requirements

FR-018: WHEN tổng hợp danh sách cảnh báo, THE system SHALL truy vấn `security_alerts sa` LEFT JOIN `zones z ON z.id=sa.zone_id AND z.deleted_at IS NULL`, LEFT JOIN `users ack ON ack.id=sa.acknowledged_by`, LEFT JOIN `users res ON res.id=sa.resolved_by`, lọc `sa.triggered_at BETWEEN [from,to]` + `filters.alertType`/`filters.zoneId`/`filters.status`, `ORDER BY sa.triggered_at DESC` (mirror sort mặc định `AlertsService.list()`), KHÔNG `LIMIT`.

FR-019: WHEN sinh file, THE system SHALL bao gồm tối thiểu mỗi dòng: `alertType, severity, zoneName|"Toàn khuôn viên", status, triggeredAt, occurrenceCount, acknowledgedByName|null, acknowledgedAt|null, resolvedByName|null, resolvedAt|null, resolutionNote|null` (đúng POST-1 SRS: "loại, thời gian, khu vực, trạng thái xử lý, người xử lý, ghi chú").

FR-020: THE system SHALL KHÔNG tự suy luận/tổng hợp thêm chỉ số phân tích nào ngoài liệt kê trực tiếp dữ liệu `security_alerts` (BR1 SRS — vd KHÔNG tự tính "tỷ lệ xử lý đúng hạn" hay phân loại mức độ nghiêm trọng tổng hợp nếu không được yêu cầu rõ).

### 3.8 Notification / Audit Requirements

FR-021: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN job tạo thành công, THE system SHALL ghi audit log non-blocking `action_type='export_security_alert_report'`.

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-129 POST-1, BR1 |
| FR-004–FR-007 | Event-driven | UC-129 Normal Flow bước 1-5 |
| FR-008 | State-driven | §0.1 |
| FR-009 | Optional Feature | UC-129 Normal Flow bước 1 |
| FR-010–FR-016 | Unwanted Behavior | Validation |
| FR-017 | Authorization | Pattern chung |
| FR-018–FR-020 | Data & State | §0.2, §0.4, BR1 |
| FR-021 | Notification/Audit | Pattern chung |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về `202` trong vòng dưới 500ms.

### 4.2 Security

NFR-002: THE system SHALL yêu cầu authentication cho mọi request.

### 4.3 Reliability & Consistency

NFR-003: THE system SHALL đảm bảo job không treo vĩnh viễn ở `running`.

NFR-004: THE system SHALL đảm bảo tổng số dòng trong file = tổng số `security_alerts` khớp filter (đối chiếu trực tiếp qua `COUNT(*)` khi kiểm thử).

### 4.4 Usability

NFR-005: THE system SHALL trả về clear error messages, field names camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `security_alerts` | Nguồn dữ liệu chính | Không soft-delete, dedup qua `recordAlert()` (Bước 3) |
| `zones` | Tên khu vực | JOIN kèm `deleted_at IS NULL`, `zoneId=null` hợp lệ (global) |
| `users` | Người xử lý | JOIN 2 lần (`acknowledgedBy`/`resolvedBy`) |
| `background_jobs`, `media_files` | Vòng đời job + lưu file | Tái dùng nguyên |

### 5.2 Dữ liệu đầu vào

**POST /api/v1/reports/security-alert/exports**

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Có | Bắt đầu khoảng (`triggered_at`) | ISO date |
| to | date (ISO 8601) | Có | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| format | string | Có | `pdf`/`xlsx` | Enum hợp lệ |
| filters.alertType | string | Không | Lọc loại cảnh báo | Free string (mirror `AlertsService.list`) |
| filters.zoneId | UUID | Không | Lọc khu vực | UUID hợp lệ |
| filters.status | string | Không | Lọc trạng thái xử lý | `new`/`acknowledged`/`resolved` |

### 5.3 Dữ liệu đầu ra

**Response 202:** `{jobId, status:'queued', delivery:'download', outputFileId:null}`.

**Nội dung file:** danh sách cảnh báo (§3.7 FR-019), sắp xếp `triggeredAt` giảm dần, kèm tổng hợp đầu trang (tổng số cảnh báo, phân bổ theo `status`).

### 5.4 Data Constraints

- Không ghi/sửa/xóa `security_alerts`.
- Không thêm bảng/cột mới — chỉ seed 1 permission mới.
- Không suy luận/phân tích thêm ngoài dữ liệu đã có (BR1 SRS).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN worker hoàn tất sinh file, THE system SHALL tạo 1 bản ghi `media_files` mới rồi cập nhật `background_jobs.output_file_id`.

### 5.6 Cần làm rõ

- **CL-1**: "Phân bổ theo status" ở phần tổng hợp đầu trang (§5.3) là bổ sung hợp lý cho UX báo cáo (đếm số lượng theo 3 trạng thái) — cần xác nhận đây KHÔNG vi phạm BR1 "không suy luận thêm" (là phép đếm trực tiếp trên dữ liệu đã lọc, không phải suy luận/phân tích mới). Khuyến nghị: giữ lại vì là COUNT thuần túy, không phải chỉ số phân tích (khác vd "tỷ lệ xử lý đúng hạn").

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` thiếu/sai/`from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `format` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `filters.zoneId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `filters.status` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `report.security_alert.export`, THEN 403 `PERMISSION_DENIED`.

### 6.3 System Errors

ERR-008: IF lỗi tạo `background_jobs` record, THEN 500 `INTERNAL_ERROR`.
ERR-009: IF worker lỗi khi sinh file, THEN job chuyển `failed` với `errorMessage`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API với `from/to` hợp lệ, `format=pdf`,
Then hệ thống trả `202`, worker hoàn tất, `outputFileId` khác null.

AC-002:
Given 1 alert `status='resolved'` có `resolvedBy`/`resolutionNote`,
When job hoàn tất,
Then dòng tương ứng trong file hiển thị đúng tên người resolve + ghi chú (§3.7 FR-019).

AC-003:
Given 1 alert `zoneId=null` (global),
When job hoàn tất,
Then dòng tương ứng hiển thị "Toàn khuôn viên" (hoặc tương đương) thay vì để trống gây hiểu nhầm lỗi dữ liệu.

### 7.2 Validation & Authorization Cases

AC-004:
Given `filters.status="invalid_status"`,
When gọi API,
Then 400 `VALIDATION_ERROR`.

AC-005:
Given `format="docx"`,
When gọi API,
Then 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given tổ hợp filter không có `security_alerts` nào,
When job hoàn tất,
Then file vẫn sinh hợp lệ ghi "Không có dữ liệu", job KHÔNG `failed`.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-006 |
| AC-002 | FR-018, FR-019 |
| AC-003 | FR-018, FR-019 |
| AC-004 | FR-015, ERR-004 |
| AC-005 | FR-013, ERR-002 |
| AC-006 | FR-008 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Định dạng Word.
- Sửa `AlertsService`/`security_alerts` hiện có — chỉ đọc thêm qua data service mới.
- Bất kỳ chỉ số phân tích/suy luận mới nào ngoài liệt kê trực tiếp + đếm số lượng theo status (BR1 SRS, §5.6 CL-1).
- Lịch xuất tự động.

### 8.2 Có thể xem xét ở feature khác

- Không có.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT support export format other than pdf/xlsx.
OOS-002: THE system SHALL NOT modify AlertsService — reuse via new read-only data service only.
OOS-003: THE system SHALL NOT compute derived analytical metrics beyond direct listing and status counts (BR1 SRS).
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
