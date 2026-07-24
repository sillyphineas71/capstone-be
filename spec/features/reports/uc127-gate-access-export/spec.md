# Feature Specification: Xuất báo cáo ra vào khuôn viên

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec lần đầu cho UC-127 Xuất báo cáo ra vào khuôn viên (Bước 5). Đã đối chiếu SRS chính thức (`SRS-tiếng-Việt-3-pages-2.pdf` trang 21) + đối chiếu hạ tầng `reports` module có sẵn (2 báo cáo UC-AA-12/UC-RUM-16). 4 điểm mơ hồ đã chốt qua AskUserQuestion trước khi viết spec (xem §0 RECON). | Toàn bộ file |

---

- **Feature ID**: RPT-EXPORT-GATE-ACCESS-001
- **Feature Name**: Xuất báo cáo ra vào khuôn viên (Export Gate Access Report)
- **Use Case**: UC-127 (SRS chính thức), dựa trên dữ liệu UC-GAT-01/UC-GAT-02 (= UC-116 ghép cặp phiên + UC-117 tra cứu lịch sử, đã code ở Bước 2)
- **Module / Domain**: reports
- **Created Date**: 2026-07-23
- **Status**: Draft
- **Source Documents**:
  - `SRS-tiếng-Việt-3-pages-2.pdf` trang 21 — UC-127 đầy đủ (Actor, Trigger, Precondition, Postcondition, Normal Flow, Exceptions, Business Rules)
  - `spec/features/gate-access/uc116-pair-gate-sessions/spec.md`, `uc117-gate-access-history/spec.md` — nguồn dữ liệu + quy tắc "phiên Chưa hoàn tất không tính vào báo cáo chính thức" (BR2 UC-116)
  - `src/modules/gate-access/services/gate-access-history.service.ts` — pattern CTE `sessions` (1 dòng/1 phiên), JOIN zone `deleted_at IS NULL`
  - `spec/features/reports/feat-export-meeting-activity-report/{spec,plan,tasks}.md` — pattern kiến trúc BullMQ + renderer PDF/XLSX tái dùng nguyên vẹn
  - `src/modules/reports/reports.module.ts`, `processors/meeting-activity-report-worker.processor.ts` — xác nhận queue `report-export` đã đăng ký, dispatch theo `job.name` qua 1 `@Processor` DUY NHẤT
  - `LO_TRINH_SAVP_TAI.md` mục Bước 5 — ghi chú "nhớ loại phiên Chưa hoàn tất"
  - `CLAUDE.md`/`AGENTS.md` mục 5.5 — quy tắc JOIN zone kèm `deleted_at IS NULL`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. EX1 "không có dữ liệu" — GIỮ pattern async cũ, KHÔNG chặn tạo job (đã duyệt)

SRS EX1 viết: "Nếu không có dữ liệu nào khớp bộ lọc → thông báo 'Không có dữ liệu để xuất báo cáo' và KHÔNG tạo tác vụ xuất." Điều này khác hẳn 2 báo cáo hiện có (`meeting-activity`/`room-utilization`), vốn LUÔN enqueue BullMQ job và worker render file rỗng hợp lệ khi không có dữ liệu (FR-011 của spec UC-AA-12). **Quyết định đã duyệt (AskUserQuestion)**: giữ nguyên pattern cũ cho cả 3 báo cáo Bước 5 — LUÔN tạo job, worker render file "Không có dữ liệu trong khoảng thời gian đã chọn" hợp lệ thay vì chặn tạo job. Đây là lệch nhẹ có chủ đích so với chữ SRS, ghi rõ residual (mirror tiền lệ UC-121 Bước 4). Lý do: nhất quán kiến trúc toàn module `reports`, tránh 2 luồng xử lý khác nhau cho báo cáo cũ và mới.

### 0.2. Phạm vi phiên — TẤT CẢ phiên, kể cả vãng lai không định danh (đã duyệt)

`gate_access_logs` có 3 loại phiên: chỉ-người (`user_id` có), chỉ-xe (`user_id` NULL, vd khách vãng lai chỉ có `plate_number`), hoặc cả hai. **Quyết định đã duyệt**: báo cáo UC-127 tính TẤT CẢ phiên, không phân biệt loại — đúng nghĩa đen "ra vào khuôn viên". Cột "cá nhân"/"phòng ban" để trống (`null`) nếu là phiên vãng lai không có `user_id`. Bộ lọc `departmentId`/`userId` chỉ có tác dụng thu hẹp trong tập phiên CÓ định danh; không ảnh hưởng phiên vãng lai (khi không dùng 2 filter này).

### 0.3. Loại phiên "Chưa hoàn tất" khỏi báo cáo — tái dùng nguyên quyết định Bước 2 (BR2 UC-116)

`spec/features/gate-access/uc116-pair-gate-sessions/spec.md` đã chốt: phiên "Chưa hoàn tất" (thiếu `out` trong 24h, hoặc thiếu `in` trong 24h) KHÔNG tính vào báo cáo chính thức. UC-127 LÀ báo cáo chính thức đầu tiên dùng dữ liệu này → áp dụng lọc `session_status = 'completed'` (loại `'incomplete'`) khi tổng hợp — khác hẳn API tra cứu UC-117 (`GateAccessHistoryService.listForUser/listAll`), vốn CỐ Ý hiển thị cả phiên chưa hoàn tất cho người dùng tự theo dõi.

### 0.4. Field/entity xác nhận tồn tại thật (không suy đoán)

- `gate_access_logs`: `id, zone_id, device_id, event_id, user_id (nullable), vehicle_registration_id (nullable), plate_number (nullable), direction ('in'/'out'), access_time, paired_log_id (nullable), duration_seconds (nullable), metadata_json`. KHÔNG soft-delete (append-only log).
- `zones`: JOIN LUÔN kèm `deleted_at IS NULL` (CLAUDE.md §5.5 quy tắc 1).
- `users`: JOIN lấy `employee_code, full_name, email, department_id` khi `user_id` có giá trị.
- `departments`: JOIN lấy `department_name` khi cần hiển thị tên phòng ban.
- Pattern ghép phiên (CTE `sessions`, self-join `paired_log_id`, `session_status`) tái dùng NGUYÊN VẸN logic của `GateAccessHistoryService` (không sửa file đó — viết `GateAccessExportDataService` riêng trong module `reports`, mirror công thức).
- Không có bảng/cột nào cần thêm. Chỉ seed 1 permission mới `report.gate_access.export`.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `reports`, cho phép Admin/Manager trích xuất báo cáo tổng hợp lịch sử ra/vào khuôn viên (PDF/Excel) trong 1 khoảng thời gian, theo bộ lọc cổng/phòng ban/cá nhân tùy chọn. Nguồn dữ liệu là `gate_access_logs` đã được ghép cặp bởi cron `GateAccessPairingService` (Bước 2). Xử lý bất đồng bộ qua `background_jobs` + BullMQ, tái dùng 100% hạ tầng đã có ở 2 báo cáo trước.

### 1.2 Mục tiêu

Cho phép Admin/Manager cấu hình và khởi tạo job xuất báo cáo ra/vào khuôn viên theo khoảng thời gian/bộ lọc, nhận file PDF hoặc Excel liệt kê từng phiên ra/vào (đã ghép cặp, loại phiên chưa hoàn tất) phục vụ họp giao ban, đối soát chấm công, hoặc lưu trữ kiểm toán.

### 1.3 Giá trị mang lại

- Cho Manager: đối soát ra/vào của phòng ban mình phụ trách.
- Cho Admin: tài liệu tổng hợp phục vụ kiểm toán an ninh/chấm công toàn khuôn viên.

### 1.4 Giả định

- LUÔN enqueue job kể cả không có dữ liệu khớp — §0.1.
- Tính tất cả phiên (người + vãng lai) — §0.2.
- Loại phiên "Chưa hoàn tất" — §0.3.
- Chỉ hỗ trợ `format IN ('pdf','xlsx')`, không hỗ trợ Word (BR1 SRS).
- Không hỗ trợ lịch xuất tự động — luôn là thao tác thủ công (BR2 SRS).

### 1.5 Clarifications Resolved

4 câu hỏi đã chốt qua AskUserQuestion (2026-07-23): EX1 giữ pattern cũ, phạm vi phiên (tất cả, kể cả vãng lai), phạm vi UC-128 (không liên quan file này), filter cổng UC-128 (không liên quan file này). Riêng UC-127 áp dụng §0.1 và §0.2 ở trên.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager | Quản lý cấp phòng ban | Xuất báo cáo giới hạn phòng ban mình phụ trách (theo `users.department_id` của người có `user_id` trong phiên) |
| Business Admin / System Admin | Quản trị viên | Xuất báo cáo toàn khuôn viên hoặc lọc theo `zoneId`/`departmentId`/`userId` bất kỳ |
| Report Rendering Service | Secondary actor (SRS) | Renderer PDF/XLSX nội bộ, tái dùng nguyên hạ tầng `pdfkit`/`exceljs` |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `report.gate_access.export` (permission mới — cần seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (mirror UC-AA-12 §2.2) — lọc theo `users.department_id` của người thực hiện phiên (chỉ ảnh hưởng phiên có `user_id`; phiên vãng lai không có `user_id` bị LOẠI KHI Manager áp scope, vì không thể xác định phòng ban). Truyền `scope.departmentId` ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `report.gate_access.export`.
- Manager không rollup phòng ban con (nhất quán các báo cáo khác).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL không tạo/sửa/xóa bất kỳ bản ghi nào trong `gate_access_logs`/`zones`/`vehicle_registrations` khi sinh báo cáo — chỉ đọc để tổng hợp.

FR-002: THE system SHALL xử lý yêu cầu xuất báo cáo bất đồng bộ qua `background_jobs` (`job_type='export_report'`) + queue `report-export` đã có, KHÔNG trả file trực tiếp trong response tạo job.

FR-003: THE system SHALL tái dùng nguyên `BackgroundJobsService`/endpoint `GET /api/v1/background-jobs/:id` và `GET /media-files/:fileId` đã có — không xây route mới cho polling/download.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu POST /api/v1/reports/gate-access/exports, THE system SHALL kiểm tra authentication và permission `report.gate_access.export` trước khi xử lý logic khác.

FR-005: WHEN request hợp lệ, THE system SHALL tạo 1 `background_jobs` record (`job_type='export_report'`, `input_json` chứa `{from, to, format, scope: {zoneId, departmentId, userId}}`) và trả `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.

FR-006: WHEN currentUser có role MANAGER và không truyền `scope.departmentId`, THE system SHALL tự động giới hạn báo cáo trong phòng ban mình quản lý.

FR-007: WHEN currentUser có role BUSINESS_ADMIN/SYSTEM_ADMIN, THE system SHALL cho phép lọc theo `zoneId`/`departmentId`/`userId` bất kỳ trong toàn hệ thống.

FR-008: WHEN worker xử lý job, THE system SHALL `markRunning()`, tổng hợp danh sách phiên theo §3.7, sinh file theo `format`, lưu vào `media_files`, rồi `markCompleted(jobId, {outputFileId, fileName})` — kể cả khi danh sách rỗng (§0.1).

FR-009: IF worker gặp lỗi trong quá trình tổng hợp/sinh file, THEN THE system SHALL gọi `markFailed(jobId, errorMessage)`.

### 3.3 State-driven Requirements

FR-010: WHILE tổ hợp filter không có phiên `completed` nào trong `[from,to]` + scope, THE system SHALL vẫn sinh file báo cáo hợp lệ ghi rõ "Không có dữ liệu trong khoảng thời gian đã chọn", KHÔNG để job `failed` (§0.1).

### 3.4 Optional Feature Requirements

FR-011: WHERE `scope.zoneId`/`scope.departmentId`/`scope.userId` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

### 3.5 Unwanted Behavior Requirements

FR-012: IF người dùng chưa đăng nhập, THEN 401.

FR-013: IF người dùng không có permission `report.gate_access.export`, THEN 403 `PERMISSION_DENIED`.

FR-014: IF currentUser có role MANAGER và `scope.departmentId` không thuộc phòng ban mình quản lý, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

FR-015: IF `from`/`to` thiếu, sai định dạng ISO date, hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.

FR-016: IF `format` không thuộc `{pdf, xlsx}`, THEN 400 `VALIDATION_ERROR` (BR1 SRS — không hỗ trợ Word).

FR-017: IF `scope.zoneId`/`scope.departmentId`/`scope.userId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.

FR-018: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days` (tái dùng config UC-AA-01, không tạo key mới), THEN 400 `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-019: WHEN the user performs a protected action (tạo job xuất báo cáo), THE system SHALL verify authentication và authorization trước khi tạo `background_jobs` record.

FR-020: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho toàn bộ truy vấn tổng hợp dữ liệu khi worker xử lý job (không chỉ ở bước tạo job).

### 3.7 Data & State Requirements

FR-021: WHEN tổng hợp danh sách phiên, THE system SHALL dùng CTE `sessions` mirror `GateAccessHistoryService` (self-join `paired_log_id`, JOIN `zones` kèm `deleted_at IS NULL`), lọc `session_status = 'completed'` (§0.3), sắp xếp theo `check_in_time` (hoặc `check_out_time` nếu thiếu) TĂNG DẦN.

FR-022: WHEN 1 phiên có `user_id`, THE system SHALL JOIN `users` lấy `employeeCode, fullName, email, departmentId → department_name`; WHEN phiên KHÔNG có `user_id` (vãng lai), THE system SHALL để các cột này `null` (§0.2), KHÔNG loại phiên khỏi báo cáo trừ khi filter `departmentId`/`userId` được áp dụng.

FR-023: WHEN 1 phiên có `plate_number`/`vehicle_registration_id`, THE system SHALL hiển thị biển số kèm theo (mirror cột hiển thị của UC-117), không JOIN sâu thêm dữ liệu chủ xe (đã có trong UC-128 riêng).

FR-024: WHEN sinh file mỗi định dạng, THE system SHALL bao gồm tối thiểu mỗi dòng: `zoneCode, zoneName, employeeCode|null, fullName|null, departmentName|null, plateNumber|null, checkInTime, checkOutTime, durationSeconds`, cùng phần tổng hợp đầu trang (tổng số phiên, khoảng thời gian, bộ lọc áp dụng).

### 3.8 Notification / Audit Requirements

FR-025: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN job tạo thành công, THE system SHALL ghi audit log non-blocking `action_type='export_gate_access_report'`, `entity_type='background_jobs'`, `entity_id=jobId`.

### 3.9 Complex / Combined Requirements

FR-026: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL vẫn tạo job (không lỗi ở bước tạo) nhưng worker sinh file rỗng như FR-010.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-127 POST-1, pattern reports module |
| FR-004–FR-009 | Event-driven | UC-127 Normal Flow bước 1-6 |
| FR-010 | State-driven | §0.1 (lệch EX1) |
| FR-011 | Optional Feature | UC-127 Normal Flow bước 1 |
| FR-012–FR-018 | Unwanted Behavior | Validation, BR1 |
| FR-019, FR-020 | Authorization | Mirror UC-AA-12 §2.2 |
| FR-021–FR-024 | Data & State | §0.3, §0.4 |
| FR-025 | Notification/Audit | Pattern `report.meeting_activity.export` |
| FR-026 | Complex | Mirror UC-AA-12 FR-030 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về `202` (tạo job) trong vòng dưới 500ms.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN từ chối tại tầng validate trước khi tạo job.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở cả bước tạo job LẪN bước worker tổng hợp dữ liệu.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo job không bao giờ treo vĩnh viễn ở `running`.

NFR-006: THE system SHALL đảm bảo tổng số phiên trong file = tổng số phiên `session_status='completed'` khớp filter (đối chiếu được bằng query trực tiếp DB khi kiểm thử).

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages, field names camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `gate_access_logs` | Nguồn dữ liệu chính | Append-only, self-join qua `paired_log_id` |
| `zones` | Tên/mã cổng | JOIN kèm `deleted_at IS NULL` |
| `users`, `departments` | Định danh người (nếu có), scope Manager | `user_id` nullable trên `gate_access_logs` |
| `background_jobs`, `media_files` | Vòng đời job + lưu file output | Tái dùng nguyên |

### 5.2 Dữ liệu đầu vào

**POST /api/v1/reports/gate-access/exports**

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Có | Bắt đầu khoảng (theo `access_time`/`check_in_time`) | ISO date |
| to | date (ISO 8601) | Có | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| format | string | Có | `pdf`/`xlsx` | Enum hợp lệ |
| scope.zoneId | UUID | Không | Lọc 1 cổng | UUID hợp lệ |
| scope.departmentId | UUID | Không | Lọc 1 phòng ban | MANAGER chỉ được truyền phòng ban mình quản lý |
| scope.userId | UUID | Không | Lọc 1 cá nhân | UUID hợp lệ |

### 5.3 Dữ liệu đầu ra

**Response 202 (tạo job):** `{jobId, status:'queued', delivery:'download', outputFileId:null}` — mirror `feat-export-meeting-activity-report`.

**Nội dung file:** danh sách phiên (§3.7 FR-024), sắp xếp theo thời gian tăng dần, kèm phần tổng hợp đầu trang.

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nghiệp vụ nguồn.
- Không thêm bảng/cột mới — chỉ seed 1 permission mới.
- File output lưu qua `media_files`, không lưu binary trực tiếp vào `background_jobs`.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã dùng ở UC-AA-12.

FR-DATA-002: WHEN worker hoàn tất sinh file, THE system SHALL tạo 1 bản ghi `media_files` mới rồi cập nhật `background_jobs.output_file_id`.

### 5.6 Cần làm rõ

- **CL-1**: Filter `scope.userId` — SRS Normal Flow nói "cá nhân" nhưng không nói rõ có cho phép Manager truyền `userId` ngoài phòng ban mình quản lý hay không. **Khuyến nghị áp dụng**: nếu Manager truyền `userId` không thuộc phòng ban mình quản lý → 403 `DEPARTMENT_OUT_OF_SCOPE` (nhất quán §2.2), cần xác nhận lại nếu có phản đối.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` thiếu/sai/`from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `format` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `scope.*` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-005: IF chưa đăng nhập, THEN 401.
ERR-006: IF không có permission `report.gate_access.export`, THEN 403 `PERMISSION_DENIED`.
ERR-007: IF MANAGER truyền `scope.departmentId`/`scope.userId` ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-008: IF lỗi tạo `background_jobs` record, THEN 500 `INTERNAL_ERROR`.
ERR-009: IF worker lỗi khi sinh file, THEN job chuyển `failed` với `errorMessage`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API với `from/to` hợp lệ, `format=pdf`,
Then hệ thống trả `202`, worker hoàn tất, `GET /api/v1/background-jobs/:id` trả `status='completed'`, `outputFileId` khác null.

AC-002:
Given có 1 phiên vãng lai (`user_id=null`, có `plate_number`) trong khoảng thời gian,
When job hoàn tất,
Then phiên đó xuất hiện trong báo cáo với cột cá nhân/phòng ban để trống (§0.2).

AC-003:
Given có 1 phiên `session_status='incomplete'` trong khoảng thời gian,
When job hoàn tất,
Then phiên đó KHÔNG xuất hiện trong báo cáo (§0.3).

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `scope.departmentId` không thuộc phòng ban mình quản lý,
When gọi API,
Then 403 `DEPARTMENT_OUT_OF_SCOPE`.

AC-005:
Given `format="docx"`,
When gọi API,
Then 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given tổ hợp filter không có phiên `completed` nào,
When job hoàn tất,
Then file vẫn sinh hợp lệ ghi "Không có dữ liệu", job KHÔNG `failed` (§0.1).

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-008 |
| AC-002 | FR-022 |
| AC-003 | FR-021 |
| AC-004 | FR-014, ERR-007 |
| AC-005 | FR-016, ERR-002 |
| AC-006 | FR-010 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Định dạng Word (BR1 SRS).
- Lịch xuất báo cáo tự động/scheduled export (BR2 SRS).
- Xây lại cơ chế polling/status/download job — tái dùng endpoint đã có.
- Sửa `GateAccessHistoryService`/`GateAccessPairingService` hiện có — chỉ đọc dữ liệu qua data service mới trong `reports`.

### 8.2 Có thể xem xét ở feature khác

- Chặn tạo job đồng bộ khi rỗng (đúng chữ SRS EX1) nếu team đổi ý sau này.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT support export format other than pdf/xlsx.
OOS-002: THE system SHALL NOT support scheduled/automatic export.
OOS-003: THE system SHALL NOT build a new job-status polling endpoint — reuse GET /api/v1/background-jobs/:id.
OOS-004: THE system SHALL NOT modify GateAccessHistoryService/GateAccessPairingService — read-only reuse via new data service.
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
