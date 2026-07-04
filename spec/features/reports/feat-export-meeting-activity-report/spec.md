# Feature Specification: Xuất báo cáo tổng hợp hoạt động cuộc họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-12 / UC-158 Xuất báo cáo tổng hợp hoạt động cuộc họp. Đã phân tích, liệt kê điểm mơ hồ (bao gồm mâu thuẫn nội tại giữa Normal Flow/Postcondition/Contract), đề xuất phương án và được người dùng duyệt 4 quyết định chính (hỗ trợ cả PDF+Excel, cấu trúc báo cáo cố định 4 phần, scope thống nhất theo người tổ chức, chỉ hỗ trợ kênh download) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: RPT-EXPORT-MEETING-ACTIVITY-001
- **Feature Name**: Xuất báo cáo tổng hợp hoạt động cuộc họp (Export Meeting Activity Report)
- **Use Case**: UC-AA-12 Xuất báo cáo tổng hợp hoạt động cuộc họp (= UC-158 trong API Contract)
- **Module / Domain**: reports
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-12 (actor, trigger, precondition, postcondition, normal flow, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-158 (endpoint/request/response mẫu — **có field `sections`/`organizerId`/`delivery` không khớp hoàn toàn Normal Flow**)
  - `src/modules/reports/reports.module.ts` — xác nhận module hiện **hoàn toàn rỗng** (`@Module({})`), chưa có controller/service nào (kể cả UC-49 xuất báo cáo phòng cũng chưa được code)
  - `src/modules/administration/services/background-jobs.service.ts` + `controllers/background-jobs.controller.ts` — xác nhận hạ tầng job async **đã có sẵn đầy đủ vòng đời** (`createQueuedJob/markRunning/markCompleted/markFailed`) và endpoint polling `GET /api/v1/background-jobs/:id` **đã hoạt động**, dùng chung cho mọi loại job (transcription, export...) — tái dùng nguyên vẹn, không xây lại
  - `src/modules/administration/entities/background-job.entity.ts` — xác nhận `BackgroundJobType.EXPORT_REPORT` đã tồn tại sẵn trong enum
  - `src/modules/recording/entities/media-file.entity.ts` — vị trí thực tế của `MediaFileEntity` (dùng lưu file output)
  - `spec/features/analytics/feat-view-dashboard-overview/spec.md` (UC-AA-01) — tái dùng định nghĩa `meetingCount`
  - `spec/features/analytics/feat-view-meeting-status-breakdown/spec.md` (UC-AA-05) — tái dùng thứ tự phân loại 4 trạng thái
  - `spec/features/analytics/feat-view-room-utilization-rate/spec.md` (UC-AA-08) — tái dùng `reservationUtilizationRate`
  - `spec/features/analytics/feat-view-no-show-rate/spec.md` (UC-AA-09) — tái dùng công thức `noShowRate`
  - `spec/features/analytics/feat-view-on-time-rate/spec.md` (UC-AA-10) — tái dùng công thức `onTimeRate` (điều chỉnh scope — xem §0.3)
  - `.specify/memory/constitution.md`, `CLAUDE.md` (mục 19 Background jobs)

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Định dạng file — hỗ trợ cả PDF và Excel — đã duyệt

Normal Flow bước 3 chỉ trình diễn "chọn PDF" (đọc như duy nhất), nhưng Postcondition POST-1 ghi rõ "PDF hoặc Excel", và contract UC-158 cho ví dụ `"format": "xlsx"`. **Quyết định đã duyệt**: `format IN ('pdf', 'xlsx')` — coi chữ "PDF" ở Normal Flow bước 3 chỉ là ví dụ minh họa thao tác chọn, không phải giới hạn duy nhất.

### 0.2. Cấu trúc báo cáo — cố định 4 phần, bỏ `sections` linh hoạt — đã duyệt

Normal Flow bước 7 mô tả rất chi tiết 4 phần cố định ("biểu mẫu quy chuẩn"): Thông tin chung / KPI cốt lõi / Phân bổ trạng thái / Danh sách chi tiết — không có bước nào cho phép bật/tắt từng phần. Contract UC-158 có field `sections: ["overview","rooms","attendance","no_show"]` gợi ý linh hoạt hơn. **Quyết định đã duyệt**: bỏ field `sections`, báo cáo LUÔN đủ 4 phần theo đúng Normal Flow, không cho tùy chỉnh.

### 0.3. Scope thống nhất theo NGƯỜI TỔ CHỨC cho toàn bộ báo cáo — đã duyệt

UC-AA-10 (tỷ lệ đúng giờ) dùng scope theo phòng ban NGƯỜI THAM DỰ (attendee-based), khác mọi UC-AA khác dùng scope theo NGƯỜI TỔ CHỨC (organizer-based). Vì UC-AA-12 là 1 tài liệu DUY NHẤT tổng hợp nhiều chỉ số cùng lúc (không phải nhiều màn hình riêng biệt), **quyết định đã duyệt**: dùng đúng 1 mô hình scope duy nhất — theo NGƯỜI TỔ CHỨC (`meetings.organizer_id → department`) — cho toàn bộ 4 phần, kể cả chỉ số "tỷ lệ điểm danh đúng giờ" ở Phần 2 (tính trên tập participant của các meeting đã lọc theo scope organizer, KHÔNG chuyển sang scope theo attendee như UC-AA-10 gốc). Tránh trộn 2 mô hình scope trong cùng 1 file gây khó hiểu.

### 0.4. Kênh giao file — chỉ `download` — đã duyệt

Normal Flow/Postcondition chỉ mô tả tự động tải xuống. **Quyết định đã duyệt**: field `delivery` chỉ chấp nhận giá trị `"download"`; giá trị khác (vd `"email"` dù có gợi ý trong contract) → `400 VALIDATION_ERROR`. Không implement kênh email ở feature này.

### 0.5. Async — tái dùng nguyên hạ tầng `background_jobs` đã có sẵn

Contract xác nhận `Async: Yes`. **Phát hiện quan trọng**: `BackgroundJobsService`/`BackgroundJobsController` đã tồn tại đầy đủ, `BackgroundJobType.EXPORT_REPORT` đã có sẵn trong enum, endpoint polling `GET /api/v1/background-jobs/:id` đã hoạt động (owner hoặc BUSINESS_ADMIN/SYSTEM_ADMIN mới xem được). **Quyết định**: feature này CHỈ cần (1) endpoint mới `POST /api/v1/reports/meeting-activity/exports` gọi `BackgroundJobsService.createQueuedJob()` với `jobType=EXPORT_REPORT`, và (2) 1 worker/processor sinh file PDF/XLSX rồi gọi `markCompleted()` — KHÔNG xây lại cơ chế polling/status, KHÔNG tạo route mới cho việc theo dõi tiến trình.

### 0.6. Ánh xạ công thức KPI Phần 2 — tái dùng nguyên các UC-AA đã chốt

- "Tổng số cuộc họp được tạo" = tái dùng định nghĩa `meetingCount` của UC-AA-01 (`status <> 'draft'`).
- "Tỷ lệ khai thác phòng họp" = `reservationUtilizationRate` của UC-AA-08 (`bookedHours ÷ availableHours`), KHÔNG phải `roomOccupancyRate` — khớp đúng tên gọi "khai thác đặt phòng" đã dùng ở UC-AA-08.
- "Tỷ lệ No-show tổng hợp" = tái dùng nguyên công thức UC-AA-09 (`noShowCount(confirmed,released) ÷ totalBookings`, theo `room_bookings.reserved_start_time`).
- "Tỷ lệ điểm danh đúng giờ" = tái dùng công thức UC-AA-10 (`onTimeCount ÷ totalRequiredParticipants`, gồm cả absent, chỉ tính `meetings.status='completed'`), nhưng scope theo organizer (§0.3).

### 0.7. Phần 3 — tái dùng nguyên thứ tự phân loại 4 trạng thái của UC-AA-05

Không định nghĩa lại: `Cancelled → No-show (qua no_show_cases) → Completed → Scheduled`, loại `draft/pending_approval/in_progress` khỏi mẫu số (đúng UC-AA-05 §0.3).

### 0.8. Phần 4 — "Tỷ lệ thành viên tham gia" mỗi dòng = tỷ lệ CÓ MẶT, không phải tỷ lệ đúng giờ

**Quyết định**: cho mỗi cuộc họp trong danh sách chi tiết, tính `participationRate = (present + late) ÷ totalInvited` (đã tham dự, bất kể đúng giờ hay muộn) — khác "tỷ lệ đúng giờ" ở Phần 2 (chỉ tính đến giờ giấc). Lý do: cột này hỏi "tham gia" (có đến hay không), không hỏi "đúng giờ".

### 0.9. `organizerId` trong `scope` — giữ lại làm filter bổ sung tùy chọn

Có trong contract, không có trong Normal Flow literal, nhưng không mâu thuẫn (chỉ thu hẹp thêm phạm vi). **Quyết định**: giữ `scope.organizerId` (UUID, tùy chọn) bên cạnh `scope.departmentId`/`scope.roomId` (đều đơn, không multi-select — đúng chữ số ít "một phòng ban/phòng họp cụ thể" trong Normal Flow).

### 0.10. Giới hạn khoảng thời gian — tái dùng `analytics.dashboard_max_range_days`

**Quyết định**: áp dụng đúng config key đã có ở UC-AA-01 để chặn request `from/to` quá dài (tránh job quét dữ liệu nhiều năm timeout/sinh file khổng lồ), không tạo config mới.

### 0.11. "Tên doanh nghiệp/bộ phận" ở Phần 1 — không tạo config mới

Không tìm thấy `system_configs` key nào cho tên công ty. **Quyết định**: nếu có `scope.departmentId` → dùng `departments.department_name`; nếu xuất toàn công ty → dùng nhãn cố định (hardcode, có thể đổi qua code sau, không thêm config key cho MVP).

### 0.12. Field/entity xác nhận tồn tại thật (không suy đoán)

- `BackgroundJobEntity`: `id, jobType, relatedEntityType, relatedEntityId, requestedBy, status, inputJson, outputJson, outputFileId, errorMessage`. `BackgroundJobType.EXPORT_REPORT` đã có sẵn.
- `BackgroundJobsService`: `createQueuedJob/markRunning/markCompleted/markFailed/getJobStatusForUser` — tái dùng nguyên vẹn, KHÔNG sửa file này.
- `MediaFileEntity` (`src/modules/recording/entities/media-file.entity.ts`) — dùng lưu file PDF/XLSX output.
- Các entity nguồn dữ liệu: `MeetingEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`, `NoShowCaseEntity`, `AttendanceRecordEntity`, `MeetingParticipantEntity`, `UserEntity`, `DepartmentEntity` — đã xác nhận field thật ở các spec UC-AA-01/05/08/09/10 tương ứng.
- **Không có bảng/cột nào cần thêm.** Chỉ seed 1 permission mới `report.meeting_activity.export` (tên đã có sẵn trong bảng permission tổng của `API_CONTRACT`).

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `reports`, cho phép Manager/Business Admin/System Admin trích xuất báo cáo tổng hợp hoạt động cuộc họp (PDF/Excel) trong 1 khoảng thời gian, gồm 4 phần cố định: thông tin chung, KPI cốt lõi, phân bổ theo trạng thái, danh sách chi tiết. Xử lý **bất đồng bộ** qua `background_jobs` (tái dùng hạ tầng đã có), tải file qua endpoint polling chung đã tồn tại. Tính năng chỉ SINH báo cáo (read-only đối với dữ liệu nguồn).

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách), Business Admin, System Admin cấu hình và khởi tạo job xuất báo cáo hoạt động cuộc họp theo khoảng thời gian/phạm vi tùy chọn, nhận file PDF hoặc Excel đúng cấu trúc quy chuẩn.

### 1.3 Giá trị mang lại

- Cho Manager: có tài liệu tổng hợp phòng ban mình phục vụ họp giao ban/báo cáo cấp trên.
- Cho Business Admin/System Admin: tài liệu tổng hợp toàn công ty phục vụ ra quyết định vận hành/đầu tư.

### 1.4 Giả định

- Hỗ trợ cả `format=pdf` và `format=xlsx` — §0.1.
- Cấu trúc báo cáo cố định 4 phần, không có `sections` tùy chỉnh — §0.2.
- Toàn bộ báo cáo dùng 1 scope duy nhất theo organizer, kể cả on-time-rate — §0.3.
- Chỉ hỗ trợ `delivery=download` — §0.4.
- Tái dùng nguyên `BackgroundJobsService`/endpoint polling đã có, không xây lại — §0.5.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính: hỗ trợ 2 định dạng, cấu trúc cố định, scope thống nhất theo organizer, chỉ download), cùng các phương án khuyến nghị còn lại không bị phản đối — tổng hợp tại §0.1–§0.11.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xuất báo cáo giới hạn trong phạm vi phòng ban mình phụ trách |
| Business Admin | Quản trị viên doanh nghiệp | Xuất báo cáo toàn công ty hoặc lọc theo `departmentId`/`roomId`/`organizerId` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (đúng `API_CONTRACT` UC-158) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `report.meeting_activity.export` (permission mới — cần seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (tĩnh, theo organizer — nhất quán UC-AA-01/04-09). Truyền `scope.departmentId` ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`.
- Theo dõi job (`GET /api/v1/background-jobs/:id`): tái dùng nguyên authorization đã có (owner hoặc BUSINESS_ADMIN/SYSTEM_ADMIN) — không sửa.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `report.meeting_activity.export`.
- Scope Manager không rollup phòng ban con (nhất quán mọi UC-AA khác).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL không tạo/sửa/xóa bất kỳ bản ghi nghiệp vụ nguồn nào (`meetings`, `room_bookings`, `attendance_records`, `no_show_cases`) khi sinh báo cáo — chỉ đọc để tổng hợp.

FR-002: THE system SHALL xử lý yêu cầu xuất báo cáo bất đồng bộ qua `background_jobs` (`job_type='export_report'`), KHÔNG trả file trực tiếp trong response tạo job.

FR-003: THE system SHALL tái dùng nguyên `BackgroundJobsService`/endpoint `GET /api/v1/background-jobs/:id` đã có cho việc tạo job và polling trạng thái — không xây route/service mới cho việc này.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu POST /api/v1/reports/meeting-activity/exports, THE system SHALL kiểm tra authentication và permission `report.meeting_activity.export` trước khi xử lý logic khác.

FR-005: WHEN request hợp lệ, THE system SHALL tạo 1 `background_jobs` record (`job_type='export_report'`, `status='queued'`, `requested_by=currentUser.id`, `input_json` chứa `{from, to, format, scope, delivery}`) và trả về `202 {jobId, status:'queued', delivery:'download', outputFileId:null}`.

FR-006: WHEN currentUser có role MANAGER và không truyền `scope.departmentId`, THE system SHALL tự động giới hạn báo cáo trong phòng ban mình quản lý.

FR-007: WHEN currentUser có role MANAGER và truyền `scope.departmentId` thuộc phòng ban mình quản lý, THE system SHALL giới hạn báo cáo đúng phòng ban đó.

FR-008: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `scope.departmentId`/`scope.roomId`/`scope.organizerId`, THE system SHALL lọc theo đúng phạm vi đó trong toàn hệ thống.

FR-009: WHEN worker xử lý job, THE system SHALL đánh dấu `markRunning()`, tổng hợp dữ liệu 4 phần theo §0.6-§0.8, sinh file theo `format`, lưu vào `media_files`, rồi `markCompleted(jobId, {outputFileId, fileName})`.

FR-010: IF worker gặp lỗi trong quá trình tổng hợp/sinh file, THEN THE system SHALL gọi `markFailed(jobId, errorMessage)`, không để job treo ở trạng thái `running`.

### 3.3 State-driven Requirements

FR-011: WHILE tổ hợp filter không có `meetings` nào trong `[from,to]` + scope, THE system SHALL vẫn sinh file báo cáo hợp lệ với Phần 2/3/4 thể hiện giá trị `0`/danh sách rỗng, KHÔNG để job `failed` (UC gốc không định nghĩa Exceptions — coi đây là kết quả hợp lệ, không phải lỗi).

### 3.4 Optional Feature Requirements

FR-012: WHERE `scope.departmentId`/`scope.roomId`/`scope.organizerId` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

### 3.5 Unwanted Behavior Requirements

FR-013: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-014: IF người dùng không có permission `report.meeting_activity.export`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-015: IF currentUser có role MANAGER và `scope.departmentId` không thuộc phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-016: IF `from`/`to` thiếu, sai định dạng ISO date, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-017: IF `format` không thuộc {pdf, xlsx}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-018: IF `delivery` khác `"download"`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR` (§0.4).

FR-019: IF `scope.departmentId`/`scope.roomId`/`scope.organizerId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-021: WHEN the user performs a protected action (tạo job xuất báo cáo), THE system SHALL verify authentication và authorization trước khi tạo `background_jobs` record.

FR-022: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho toàn bộ truy vấn tổng hợp dữ liệu khi worker xử lý job (không chỉ ở bước tạo job).

### 3.7 Data & State Requirements

FR-023: WHEN tổng hợp Phần 1 (Thông tin chung), THE system SHALL bao gồm tên phòng ban (nếu có `scope.departmentId`, ngược lại nhãn công ty cố định — §0.11), khoảng thời gian báo cáo, email người trích xuất (`currentUser.email`), ngày giờ lập báo cáo (thời điểm worker hoàn tất).

FR-024: WHEN tổng hợp Phần 2 (KPI cốt lõi), THE system SHALL tính đúng 4 chỉ số theo công thức đã ánh xạ tại §0.6, cùng 1 scope organizer, cùng `[from,to]`.

FR-025: WHEN tổng hợp Phần 3 (Phân bổ trạng thái), THE system SHALL phân loại mỗi `meeting` vào đúng 1 trong 4 nhóm theo thứ tự ưu tiên đã chốt ở UC-AA-05 (§0.7), tính số lượng tuyệt đối và % trên tổng 4 nhóm hợp lệ.

FR-026: WHEN tổng hợp Phần 4 (Danh sách chi tiết), THE system SHALL liệt kê mọi `meetings` trong scope + `[from,to]` (không giới hạn số dòng), gồm `meetingCode, title, organizerEmail, roomName, startTime, endTime, status, participationRate` (công thức participationRate — §0.8).

FR-027: WHEN sinh file `format=pdf`, THE system SHALL dàn trang theo cấu trúc tài liệu (section/heading) đúng 4 phần.

FR-028: WHEN sinh file `format=xlsx`, THE system SHALL tổ chức thành các sheet/khối tương ứng 4 phần (vd sheet "Tổng quan" cho Phần 1+2+3, sheet "Chi tiết" cho Phần 4).

### 3.8 Notification / Audit Requirements

FR-029: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN job tạo thành công, THE system SHALL ghi audit log non-blocking `action_type='export_meeting_activity_report'`, `entity_type='background_jobs'`, `entity_id=jobId`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, format, scope}`.

### 3.9 Complex / Combined Requirements

FR-030: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL vẫn tạo job (không lỗi ở bước tạo) nhưng worker sinh file rỗng như FR-011.

FR-031: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi tạo `background_jobs` record.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-12 POST-1, §0.5 |
| FR-004–FR-010 | Event-driven | UC-AA-12 Normal Flow bước 4-8 |
| FR-011 | State-driven | UC-AA-12 Exceptions=N/A, §0.11 |
| FR-012 | Optional Feature | UC-AA-12 Normal Flow bước 3 |
| FR-013–FR-020 | Unwanted Behavior | UC-AA-12 BR1, validation |
| FR-021, FR-022 | Authorization | UC-AA-12 BR1 |
| FR-023–FR-028 | Data & State | UC-AA-12 Normal Flow bước 6-7 |
| FR-029 | Notification/Audit | Pattern audit đã dùng ở mọi feature `analytics.*` |
| FR-030, FR-031 | Complex | BR1 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về `202` (tạo job) trong vòng dưới 500ms — KHÔNG chờ worker xử lý xong trong request.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-020) trước khi tạo job.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở cả bước tạo job LẪN bước worker tổng hợp dữ liệu.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo job không bao giờ treo vĩnh viễn ở `running` — mọi lỗi phải dẫn đến `failed` (FR-010).

NFR-006: THE system SHALL đảm bảo `totalRequiredParticipants = onTimeCount + lateCount + absentCount` và các bất biến tương tự đã chốt ở UC-AA-05/08/09/10 vẫn đúng trong dữ liệu tổng hợp của báo cáo.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase cho endpoint tạo job.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `background_jobs` | Vòng đời job export | Tái dùng nguyên `BackgroundJobsService`, `job_type='export_report'` |
| `media_files` | Lưu file PDF/XLSX output | `background_jobs.output_file_id` trỏ tới đây |
| `meetings`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `attendance_records`, `meeting_participants` | Nguồn dữ liệu 4 phần | Tái dùng công thức từ UC-AA-01/05/08/09/10 |
| `users`, `departments` | Resolve scope Manager, email tổ chức | Theo organizer (§0.3) |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

**POST /api/v1/reports/meeting-activity/exports**

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Có | Bắt đầu khoảng | ISO date |
| to | date (ISO 8601) | Có | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| format | string | Có | `pdf`/`xlsx` | Enum hợp lệ (§0.1) |
| scope.departmentId | UUID | Không | Lọc 1 phòng ban | MANAGER chỉ được truyền phòng ban mình quản lý |
| scope.roomId | UUID | Không | Lọc 1 phòng họp | UUID hợp lệ |
| scope.organizerId | UUID | Không | Lọc 1 người tổ chức | UUID hợp lệ (§0.9) |
| delivery | string | Không | Mặc định `"download"` | Chỉ chấp nhận `"download"` (§0.4) |

### 5.3 Dữ liệu đầu ra

**Response 202 (tạo job):**

| Field | Type | Mô tả |
|---|---:|---|
| jobId | UUID | ID job vừa tạo |
| status | string | `"queued"` |
| delivery | string | `"download"` |
| outputFileId | null | Luôn `null` khi mới tạo |

**Polling (`GET /api/v1/background-jobs/:id`, đã có sẵn — không đổi):** trả `status`, `result` (khi `completed`), `outputFileId`, `errorMessage` (khi `failed`).

**Nội dung file báo cáo (Phần 1-4):** đúng cấu trúc mô tả tại §3.7 (FR-023 → FR-026).

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nghiệp vụ nguồn.
- Không thêm bảng/cột mới — chỉ seed 1 permission mới.
- Không tạo `sections` tùy chỉnh — luôn đủ 4 phần (§0.2).
- File output lưu qua `media_files`, không lưu binary trực tiếp vào `background_jobs`.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã có ở UC-AA-01/04-09.

FR-DATA-002: WHEN worker hoàn tất sinh file, THE system SHALL tạo 1 bản ghi `media_files` mới rồi cập nhật `background_jobs.output_file_id` trỏ tới đó (qua `markCompleted`).

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-158 hiện có `sections`/`delivery=email` không khớp thiết kế mới (cố định 4 phần, chỉ download) — cần task đồng bộ tài liệu riêng.
- **CL-2**: Cơ chế worker xử lý job (chạy inline trong process, cron polling `background_jobs.status='queued'`, hay queue thật như BullMQ) chưa được xác nhận có sẵn trong codebase — cần làm rõ ở giai đoạn `plan.md` trước khi code, không giả định trước.
- **CL-3**: Thư viện sinh PDF/XLSX cụ thể (`pdfkit`/`puppeteer`/`exceljs`...) chưa được chọn — quyết định kỹ thuật này thuộc `plan.md`, không phải phạm vi spec nghiệp vụ.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` thiếu hoặc sai định dạng hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `format` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `delivery` khác `"download"`, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `scope.*` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `report.meeting_activity.export`, THEN 403 `PERMISSION_DENIED`.
ERR-008: IF MANAGER truyền `scope.departmentId` ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-009: IF lỗi tạo `background_jobs` record, THEN 500 `INTERNAL_ERROR`.
ERR-010: IF worker lỗi khi sinh file, THEN job chuyển `failed` với `errorMessage` (không phải lỗi HTTP — client polling sẽ thấy qua `GET /api/v1/background-jobs/:id`).

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API với `from/to` hợp lệ, `format=pdf`,
Then hệ thống trả `202 {jobId, status:'queued'}`, sau đó worker hoàn tất và `GET /api/v1/background-jobs/:id` trả `status='completed'`, `outputFileId` khác null.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `scope.departmentId`,
Then báo cáo sinh ra chỉ gồm dữ liệu các cuộc họp do phòng ban "Kỹ thuật" tổ chức.

AC-003:
Given `format=xlsx`,
When job hoàn tất,
Then file output là `.xlsx` hợp lệ, có đủ dữ liệu 4 phần tổ chức theo sheet/khối tương ứng.

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `scope.departmentId` không thuộc phòng ban mình quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

AC-005:
Given `delivery="email"`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR` (§0.4).

AC-006:
Given `format="docx"` (không hợp lệ),
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-007:
Given tổ hợp filter không có meeting nào trong `[from,to]`,
When job hoàn tất,
Then file vẫn được sinh hợp lệ với Phần 2/3 = 0, Phần 4 rỗng, job KHÔNG `failed`.

AC-008:
Given 1 meeting có `status='scheduled'` nhưng có `no_show_cases.detection_status='confirmed'`,
When tổng hợp Phần 3,
Then meeting đó được xếp vào nhóm "No-show" (đúng thứ tự ưu tiên UC-AA-05), không phải "Scheduled".

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-009 |
| AC-002 | FR-006, FR-DATA-001 |
| AC-003 | FR-028 |
| AC-004 | FR-015, ERR-008 |
| AC-005 | FR-018, ERR-003 |
| AC-006 | FR-017, ERR-002 |
| AC-007 | FR-011 |
| AC-008 | FR-025 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Kênh giao file `email` — chỉ `download` (§0.4).
- `sections` tùy chỉnh — cấu trúc luôn cố định 4 phần (§0.2).
- Xây lại cơ chế polling/status job — tái dùng nguyên `GET /api/v1/background-jobs/:id` đã có (§0.5).
- Scope theo attendee cho riêng chỉ số on-time-rate — thống nhất scope organizer toàn báo cáo (§0.3).
- Rollup phòng ban con cho scope Manager.
- WebSocket push khi job hoàn tất — client polling qua endpoint đã có.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với thiết kế cố định 4 phần + chỉ `delivery=download` (CL-1).
- Kênh giao file `email` nếu phát sinh yêu cầu sau.
- Thông báo in-app/WebSocket khi job hoàn tất (giảm tải polling từ FE) nếu cần tối ưu UX sau.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT support delivery values other than "download".
OOS-002: THE system SHALL NOT allow toggling individual report sections via a sections parameter.
OOS-003: THE system SHALL NOT build a new job-status polling endpoint — reuse GET /api/v1/background-jobs/:id.
OOS-004: THE system SHALL NOT use attendee-based department scope for any metric in this report — organizer-based scope only.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 permission mới, đã có tên sẵn).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
