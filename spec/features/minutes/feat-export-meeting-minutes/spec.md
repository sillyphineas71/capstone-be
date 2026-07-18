# Feature Specification: Xuất biên bản cuộc họp (Export Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo spec cho UC-147, sau vòng phân tích hạ tầng sẵn có (queue `minutes-export`, `BackgroundJobType.EXPORT_MINUTES`, `MediaFileType.EXPORT`, `meeting_minutes.file_id` đều đã được provision sẵn nhưng chưa dùng) và Q&A xác nhận scope (format PDF+Word, quyền Host/Preparer + Business Admin) | Toàn bộ file |

> Nguồn gốc: UC-147 "Xuất biên bản cuộc họp" (Feature Table gốc, module "Notification and Reporting"; API contract stub tại `docs/API_CONTRACT_v1.0_with_system_roles.md:4776-4806`). Feature Table gốc ghi "Related Use Cases: UC-90, UC-91" — đã xác minh đây là 2 UC thuộc module Attendance/Presence (`presence-timeline`, `chỉnh sửa điểm danh thủ công`), **không liên quan** tới biên bản họp. Coi đây là cross-reference sai/cũ (vấn đề đã lặp lại nhiều lần ở Feature Table gốc, xem các spec `feat-link-minutes-resources`/`feat-view-minutes-attachment-detail`). Dependency thực sự hợp lý là UC-146 "Phân phối biên bản cuộc họp" (đứng ngay trước UC-147 trong doc) và việc biên bản phải đã tồn tại + đã ban hành (`feat-issue-meeting-minutes`).

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi biên bản họp đã được soạn thảo (`feat-create-draft-meeting-minutes`), chỉnh sửa (`feat-update-draft-meeting-minutes`), đính kèm tài liệu (`feat-attach-minutes-document`), liên kết resource (`feat-link-minutes-resources`) và ban hành chính thức (`feat-issue-meeting-minutes`, `status: draft → published`), người dùng cần **xuất bản chính thức đó ra file PDF/Word** để lưu trữ, in ấn, hoặc gửi cho người không có tài khoản hệ thống. Đây là bước cuối cùng của vòng đời "đọc/dùng" biên bản, sau bước ban hành.

Khảo sát codebase cho thấy **toàn bộ hạ tầng async-export đã được provision sẵn nhưng chưa từng được dùng**:
- `meeting_minutes.file_id` (cột đã có, để `NULL` — dùng để lưu file export "chính thức" mới nhất).
- `MediaFileType.EXPORT` (enum value đã có trong `media-file.entity.ts`, chưa từng được set).
- `BackgroundJobType.EXPORT_MINUTES = 'export_minutes'` (enum value đã có trong `background-job.entity.ts`, chưa từng được dùng).
- Queue BullMQ `'minutes-export'` (đã đăng ký trong `QueueModule`/`QueueService`, env `QUEUE_MINUTES_EXPORT`, **chưa có `@Processor` nào lắng nghe**).

Điều này cho thấy feature này đã được dự trù kiến trúc từ trước nhưng chưa bao giờ implement — khớp với ghi chú "loại Export ra khỏi phạm vi vì hạ tầng background_jobs chưa sẵn sàng" trong `feat-view-meeting-minutes-detail/spec.md` (lý do đó nay không còn đúng vì module `reports` đã chứng minh pattern này hoạt động tốt qua `export:meeting-activity`/`export:room-utilization`).

### 1.2 Mục tiêu
Cung cấp 1 endpoint `POST` bất đồng bộ cho phép người có quyền (Host/`preparedBy` của biên bản, hoặc Business Admin/System Admin) tạo job xuất **1 biên bản đã ban hành (`published`)** ra file PDF hoặc Word (.docx), lưu vào Cloud Storage (S3/MinIO qua `StorageService` có sẵn), và trả về đường dẫn tải (signed URL) sau khi job hoàn tất — tái sử dụng đúng pattern `background_jobs` + `media_files` đã chứng minh ở module `reports`.

### 1.3 Giá trị mang lại
- Hoàn thiện vòng đời biên bản: soạn → sửa → đính kèm → ban hành → **xuất file lưu trữ/in ấn/gửi ngoài hệ thống**.
- Dùng lại 100% hạ tầng đã có (`pdfkit`, `StorageService`, BullMQ, `background_jobs`, `media_files`) — không cần thêm bảng, không cần thêm queue mới.
- Kích hoạt lần đầu tiên 3 giá trị enum đã "để dành" từ trước (`MediaFileType.EXPORT`, `BackgroundJobType.EXPORT_MINUTES`, queue `minutes-export`).

### 1.4 Giả định
- Biên bản (`meeting_minutes`) đã tồn tại và **đang ở `status = published`** (xem mục 1.5 — quyết định giới hạn export cho bản chính thức, không export `draft`).
- `meeting_minutes.file_id` chỉ lưu **1 file export "mặc định"** gần nhất (PDF, đầy đủ `includeTranscript=true`/`includeActionItems=true`) — không phải mọi lần export đều ghi đè cột này (xem mục 1.5).
- Format hỗ trợ: **PDF và Word (.docx)** cả hai ngay từ đợt này (quyết định của Product Owner, khác với ví dụ mẫu trong API Contract gốc chỉ show `"format": "pdf"`). Cần thêm dependency mới `docx` (npm) — hiện dự án chỉ có `pdfkit`/`exceljs`, chưa có thư viện sinh `.docx`.
- Quyền yêu cầu export: **Host/`preparedBy` của biên bản, hoặc Business Admin/System Admin** — đúng pattern ownership-or-admin đã dùng ở `feat-issue-meeting-minutes` (KHÔNG mở rộng cho participant thường ở đợt này).
- Permission code mới dùng convention `meeting.minutes.export` (module_code=`minutes`) — nhất quán với toàn bộ permission khác của module (`meeting.minutes.read/update/delete/issue/...`), **khác** với tên `minutes.export` ghi trong API Contract gốc (sai khác có chủ đích, đã lặp lại ở mọi feature `minutes` trước đó).

### 1.5 Cần làm rõ — đã giải quyết qua phân tích + Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] Format PDF hay cả Word?** Cả hai (PDF qua `pdfkit` có sẵn; Word qua thư viện mới `docx`). Xem mục 8.1 cho rủi ro/effort tăng thêm.
- **[ĐÃ GIẢI QUYẾT] Ai được export?** Host/`preparedBy` HOẶC Business Admin/System Admin (OR-rule giống `feat-issue-meeting-minutes`), không mở cho participant thường.
- **[ĐÃ GIẢI QUYẾT] Biên bản `draft` có export được không?** KHÔNG — chỉ `status = published`. Lý do: "biên bản" đúng nghĩa văn bản chính thức, `draft` còn có thể sửa/xóa nên export ra dễ gây hiểu nhầm là bản cuối cùng, đồng thời tránh race condition giữa "đang sửa draft" và "đang export draft cũ".
- **[ĐÃ GIẢI QUYẾT] `meeting_minutes.file_id` có bị ghi đè mỗi lần export không?** KHÔNG luôn luôn — chỉ export "mặc định" (format=`pdf`, `includeTranscript=true`, `includeActionItems=true` — tương đương gọi export không truyền option) mới ghi vào `file_id`, đóng vai trò "bản lưu trữ chính thức". Các lần export tùy biến khác (format=`docx`, hoặc tắt bớt include-option) chỉ tồn tại qua `background_jobs`/`media_files`, không ghi đè `file_id`. Áp dụng để tránh 1 field `file_id` (kiểu 1-1) bị "cướp" bởi lần export gần nhất có option khác thường.
- **[ĐÃ GIẢI QUYẾT] Queue nào xử lý job?** Queue `minutes-export` đã đăng ký sẵn trong `QueueModule` (không phải `report-export` của module `reports` — giữ đúng module boundary: `minutes` sở hữu logic biên bản, `reports` chỉ dành cho báo cáo phân tích).
- **[ĐÃ GIẢI QUYẾT] Có cần polling/download endpoint mới không?** KHÔNG — tái dùng nguyên `GET /api/v1/background-jobs/:id` (biết job xong chưa + `outputFileId`) và `GET /api/v1/media-files/:id` (trả `downloadUrl` signed, đã có từ `feat-view-minutes-attachment-detail`), đúng comment `OOS-003` đã áp dụng ở `reports` module.
- **[ĐÃ GIẢI QUYẾT] `includeTranscript=true` thì lấy transcript từ đâu?** Từ `meeting_minutes.linkedTranscriptId` (nếu có, set qua `feat-link-minutes-resources`). Nếu `linkedTranscriptId = NULL`, coi `includeTranscript` là no-op (không lỗi, chỉ bỏ qua phần transcript trong file xuất ra) — tránh trường hợp block export chỉ vì thiếu transcript optional.
- **[ĐÃ GIẢI QUYẾT] `includeActionItems=true` lấy dữ liệu từ đâu?** Trực tiếp từ `meeting_minutes.actionItemsJson` (đã có sẵn trên chính bản ghi, không cần join bảng khác).
- **[ĐÃ GIẢI QUYẾT] ARCH-03 (idempotency) có áp dụng nghiêm không?** Theo đúng tiền lệ đã chấp nhận ở module `reports` (`createExportJob` không có idempotency-key handling) — **không** implement idempotency-key trong đợt này, ghi nhận là gap đã biết nhất quán với `reports`, không phải regression riêng của feature này (xem mục 8.1).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host — `meeting_minutes.preparedBy` HOẶC `meeting.hostId` hiện tại của cuộc họp gắn với biên bản.
- **Primary Actor**: Business Admin, System Admin (bypass hoàn toàn ownership check).
- Secondary Actor: Không có (participant thường không được export ở đợt này — xem mục 8).

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.export` (module_code=`minutes`, action_code=`minutes.export`).
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng cột "System Role" của UC-147 trong API Contract gốc) — sở hữu permission là điều kiện cần nhưng chưa đủ, service còn kiểm tra ownership.
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass ownership; `INTERNAL_USER`/`MANAGER` phải thỏa ownership rule (mục 2.3).

### 2.3 Actor Constraints
- `INTERNAL_USER`/`MANAGER` chỉ export được khi thỏa `userId === preparedBy OR userId === meeting.hostId`. Participant/Organizer thường (không thỏa) **không** được export.
- Biên bản phải ở `status = published` — nếu `draft`/`archived`/`deleted`, **mọi** actor đều bị từ chối, kể cả Admin.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép tạo job bất đồng bộ để xuất 1 `meeting_minutes` đang `status = published` ra file PDF hoặc Word (.docx).
- **FR-002**: THE system SHALL trả `202 Accepted` kèm `jobId` ngay khi job được enqueue thành công, KHÔNG chờ render file xong mới trả response (ARCH-02 — async cho tác vụ render/upload có thể > 2s).
- **FR-003**: THE system SHALL lưu file export vào Cloud Storage qua `StorageService` có sẵn (driver-agnostic local/S3/MinIO), tạo 1 `MediaFileEntity` (`fileType = EXPORT`) tham chiếu tới file đó.

### 3.2 Event-driven Requirements
- **FR-004**: WHEN người dùng gửi `POST /api/v1/meeting-minutes/:id/exports`, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi thỏa ownership rule HOẶC có role Admin, (3) biên bản đang `published`, (4) `format` hợp lệ (`pdf`/`docx`), trước khi tạo `background_jobs` record và enqueue job.
- **FR-005**: WHEN job được xử lý bởi worker (`@Processor('minutes-export')`), THE system SHALL: (a) `markRunning`, (b) load `meeting_minutes` + `decisionsJson`/`actionItemsJson` + (nếu `includeTranscript=true` và `linkedTranscriptId` khác NULL) transcript liên kết, (c) render file theo `format`, (d) `StorageService.saveFile()`, (e) tạo `MediaFileEntity`, (f) `markCompleted` + set `background_jobs.output_file_id`.
- **FR-006**: WHEN job là "export mặc định" (`format=pdf AND includeTranscript=true AND includeActionItems=true`, tương đương request không truyền option nào), THE system SHALL, sau khi tạo `MediaFileEntity` thành công, UPDATE `meeting_minutes.file_id` trỏ tới file mới đó (ghi đè file cũ nếu có — file cũ không bị xóa khỏi `media_files`, chỉ không còn được `file_id` trỏ tới).
- **FR-007**: WHEN job xử lý thất bại (lỗi render/upload), THE system SHALL `markFailed` với `errorMessage` rút gọn, KHÔNG throw tiếp làm crash worker (ARCH-02/pattern đã dùng ở `reports` — try/catch bọc toàn bộ `process()`).
- **FR-008**: WHEN job export thành công, THE system SHALL ghi 1 bản ghi `audit_logs` (`action_type = meeting_minutes_exported`, `entity_type = meeting_minutes`, `entity_id = minutesId`) với `newValueJson` chứa `{format, mediaFileId, includeTranscript, includeActionItems}`.

### 3.3 State-driven Requirements
- **FR-009**: WHILE `meeting_minutes.status != published`, THE system SHALL từ chối mọi request tạo export job (kể cả từ Admin), trả `409 MINUTES_NOT_PUBLISHED`.
- **FR-010**: WHILE `meeting_minutes.deletedAt IS NOT NULL`, THE system SHALL trả `404 MINUTES_NOT_FOUND` (không phân biệt với trường hợp không tồn tại).

### 3.4 Optional Feature Requirements
- **FR-011**: WHERE `includeTranscript = true` NHƯNG `meeting_minutes.linkedTranscriptId IS NULL`, THE system SHALL vẫn render file thành công, chỉ bỏ qua phần nội dung transcript (không coi là lỗi).
- **FR-012**: WHERE `format = docx` được yêu cầu, THE system SHALL render qua thư viện `docx` (dependency mới) theo layout tương đương bản PDF (không cần pixel-perfect giống nhau, chỉ cần đủ nội dung).

### 3.5 Unwanted Behavior Requirements
- **FR-013**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MINUTES_NOT_FOUND`.
- **FR-014**: IF người gọi là `INTERNAL_USER`/`MANAGER` và không thỏa ownership rule, THEN THE system SHALL trả `403 NOT_MINUTES_OWNER`.
- **FR-015**: IF người gọi không có permission `meeting.minutes.export`, THEN THE system SHALL trả `403 FORBIDDEN`.
- **FR-016**: IF `format` không phải `pdf` hoặc `docx`, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-017**: IF `minutesId` (path param) không phải UUID hợp lệ, THEN THE system SHALL trả `400`.

### 3.6 Workflow Requirements
- **FR-018**: THE system SHALL thực hiện toàn bộ bước validate (mục 3.2 FR-004) trong request đồng bộ TRƯỚC khi enqueue — KHÔNG enqueue job rồi mới validate trong worker (tránh tạo `background_jobs`/queue message rác cho request lỗi 4xx).
- **FR-019**: THE system SHALL KHÔNG cung cấp endpoint polling/download mới — tái dùng `GET /api/v1/background-jobs/:id` và `GET /api/v1/media-files/:id` đã có sẵn (đúng pattern `reports` module).

### 3.7 Data & State Requirements
- **FR-020**: THE system SHALL KHÔNG thêm bảng mới, KHÔNG thêm cột mới. Chỉ dùng lại các cột/enum đã có sẵn trong baseline: `meeting_minutes.file_id`, `MediaFileType.EXPORT`, `BackgroundJobType.EXPORT_MINUTES`, queue `minutes-export`.
- **FR-021**: THE system SHALL thêm 1 permission mới (`meeting.minutes.export`) qua migration seed — không sửa bảng `permissions`/`role_permissions` bằng tay ngoài migration.

### 3.8 Notification / Audit Requirements
- **FR-022**: Xem FR-008 cho audit log.
- **FR-023**: THE system SHALL KHÔNG gửi notification tự động khi export xong trong phạm vi feature này (khác với `feat-issue-meeting-minutes` có gửi `minutes_distribution` — export ở đây là hành động "tải xuống cho actor", không phải "phân phối cho participant khác"; việc phân phối thuộc UC-146 riêng, ngoài phạm vi).

### 3.9 Complex / Combined Requirements
- **FR-024**: IF `minutes.status = published` AND (người gọi thỏa ownership rule HOẶC là Admin) AND `format ∈ {pdf, docx}`, THEN THE system SHALL: tạo `background_jobs` (status=`queued`, jobType=`export_minutes`), enqueue BullMQ job vào queue `minutes-export`, và trả `202` kèm `jobId` — tất cả trong 1 lần gọi đồng bộ (phần render diễn ra bất đồng bộ sau đó, xem FR-005).

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002, FR-003 | UC-147 gốc (Async: Yes, "Sinh file PDF/Word, upload S3 và trả Signed URL") |
| FR-004, FR-024 | Q&A "quy trình validate trước enqueue" (mục 1.5) + pattern `reports.createExportJob` |
| FR-005, FR-007 | Pattern `MeetingActivityReportWorkerProcessor.process()` (module `reports`) |
| FR-006 | Q&A "`file_id` chỉ ghi đè bởi export mặc định" (mục 1.5) |
| FR-009 | Q&A "chỉ export `published`" (mục 1.5) |
| FR-011, FR-012 | Q&A "format PDF+Word" + "transcript optional" (mục 1.5) |
| FR-014, FR-015 | Q&A "quyền Host/Preparer + Business Admin" (mục 1.5) |
| FR-019 | Comment `OOS-003` đã có sẵn trong `reports` module, áp dụng lại |
| FR-023 | Phân biệt rõ "export" (UC-147, tải cho actor) và "distribute" (UC-146, gửi cho participant khác) |

## 4. Non-functional Requirements

### 4.1 Performance
- API tạo job (đồng bộ) phải phản hồi trong < 500ms (chỉ gồm validate + 1 INSERT `background_jobs` + 1 lần `queue.add()`).
- Thời gian render/upload thực tế (bất đồng bộ, không tính vào SLA API) phụ thuộc kích thước biên bản — không có SLA cứng trong phạm vi feature này (tương tự `reports` module không cam kết SLA render).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ và permission `meeting.minutes.export`.
- Ownership/Admin-bypass check enforce ở tầng service, không tin tưởng tham số phân quyền từ client.
- File export chứa nội dung biên bản (dữ liệu nhạy cảm theo CLAUDE.md §20.2 "Meeting content/minutes") — `MediaFileEntity.visibilityLevel = INTERNAL`, download bắt buộc qua signed URL (TTL ngắn), không public URL trực tiếp.

### 4.3 Reliability & Consistency
- Idempotency: KHÔNG implement idempotency-key ở đợt này (nhất quán gap đã có ở `reports` module — xem mục 1.5). Gọi lại export nhiều lần tạo nhiều job/file độc lập, không lỗi nhưng cũng không dedupe.
- Job lỗi được `markFailed` với `errorMessage`, không để job "treo" ở trạng thái `running` vĩnh viễn (bọc try/catch toàn bộ `process()`, theo đúng pattern `reports`).

### 4.4 Usability
- Response 202 trả đủ `jobId` để FE có thể chủ động poll `GET /background-jobs/:id` và hiển thị progress/toast khi hoàn tất.

### 4.5 Observability
- Log đủ `minutesId`, `userId`, `format`, `jobId`, kết quả (success/lỗi + code) — cả ở bước tạo job (service) và bước xử lý (worker).

### 4.6 Maintainability
- Business logic tạo job đặt trong `MinutesService` (method mới `createExportJob`), tái sử dụng ownership-check helper đã có từ `issueMinutes`/`updateDraft`/`deleteDraft` (factor ra hàm chung nếu team thấy hợp lý, không bắt buộc trong phạm vi feature này).
- Renderer PDF/Word đặt ở file riêng (`renderers/meeting-minutes-pdf-renderer.ts`, `renderers/meeting-minutes-docx-renderer.ts`), theo đúng cấu trúc thư mục `renderers/` đã dùng ở `reports`.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc (nội dung export) + ghi có điều kiện (`file_id`, chỉ khi export mặc định — FR-006).
- `MeetingEntity` (bảng `meetings`) — đọc `hostId` (ownership check), không ghi.
- `TranscriptEntity` (bảng `transcripts`) — đọc (nếu `includeTranscript=true` và có `linkedTranscriptId`), không ghi.
- `BackgroundJobEntity` (bảng `background_jobs`) — ghi (tạo job, cập nhật trạng thái/`outputFileId`).
- `MediaFileEntity` (bảng `media_files`) — ghi (tạo record file export, `fileType=EXPORT`).
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng khi job hoàn tất thành công.

### 5.2 Dữ liệu đầu vào
Path param: `id` (UUID, bắt buộc — id của `meeting_minutes`).

Request body:
```jsonc
{
  "format": "pdf",              // bắt buộc, enum: "pdf" | "docx"
  "includeTranscript": false,   // optional, default false
  "includeActionItems": true    // optional, default true
}
```

### 5.3 Dữ liệu đầu ra (Response 202)
```jsonc
{
  "success": true,
  "message": "Da tao yeu cau xuat bien ban, dang xu ly",
  "data": {
    "jobId": "uuid",
    "status": "queued",
    "minutesId": "uuid",
    "format": "pdf",
    "estimatedCompletion": null
  }
}
```

Sau khi job hoàn tất (client tự poll `GET /background-jobs/:id`), response của endpoint đó chứa `outputJson.outputFileId`. Client gọi tiếp `GET /media-files/:id` để lấy `downloadUrl` (signed URL) — theo đúng contract đã có ở `feat-view-minutes-attachment-detail`.

### 5.4 State / Status Model
`background_jobs.status`: `queued → running → completed | failed` (dùng enum `BackgroundJobStatus` có sẵn, không thêm giá trị mới). `meeting_minutes.status` KHÔNG bị feature này thay đổi (export là thao tác đọc-và-tạo-file-phái-sinh, không phải state transition của biên bản).

### 5.5 Data Constraints
- Chỉ tạo job export khi `meeting_minutes.status = published` (không phải `draft`/`archived`/`deleted`).
- `format` chỉ nhận `pdf` hoặc `docx` — không có `xlsx`/`csv` cho biên bản (khác `reports` vốn hỗ trợ nhiều format).
- `meeting_minutes.file_id` chỉ được ghi bởi export "mặc định" (xem FR-006) — export tùy biến khác không đụng cột này.

### 5.6 Data Lifecycle
Ban hành (`feat-issue-meeting-minutes`, `status=published`) → **Xuất file (feature này, có thể lặp lại nhiều lần, không giới hạn số lần export)** → (ngoài phạm vi) Phân phối file cho người ngoài hệ thống (UC-146). Export không phải bước "terminal" của vòng đời biên bản — biên bản vẫn có thể được export lại bất cứ lúc nào sau khi published (không có giới hạn số lần).

### 5.7 Data-related EARS Requirements
Xem FR-003, FR-006, FR-020.

## 6. Error Handling

### 6.1 Validation Errors
- `id` (path param) không phải UUID hợp lệ → `400` (`ParseUUIDPipe`).
- `format` thiếu hoặc không thuộc `{pdf, docx}` → `400 VALIDATION_ERROR`.
- `includeTranscript`/`includeActionItems` không phải boolean (nếu có) → `400 VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission `meeting.minutes.export` → `403 FORBIDDEN`.
- Có permission nhưng không thỏa ownership rule (và không phải Admin) → `403 NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → `404 MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `published` → `409 MINUTES_NOT_PUBLISHED` (kể cả với Admin).

### 6.4 Conflict Errors
Xem 6.3 (`MINUTES_NOT_PUBLISHED`).

### 6.5 Integration / External Service Errors
- Lỗi render (pdfkit/docx) hoặc lỗi upload `StorageService` xảy ra TRONG worker (bất đồng bộ, sau khi API đã trả `202`) → job `markFailed`, KHÔNG trả lỗi HTTP nào cho request gốc (đã trả 202 trước đó). Client biết lỗi qua polling `GET /background-jobs/:id` (`status=failed`, `errorMessage`).

### 6.6 Error Response Expectations
```jsonc
{
  "success": false,
  "message": "...",
  "error": { "code": "...", "details": {} },
  "timestamp": "...",
  "path": "..."
}
```

## 7. Acceptance Criteria

### 7.1 Happy Path
- **AC-001**: GIVEN biên bản `M` có `status=published`, `preparedBy=U`, WHEN `U` gọi POST export với `format=pdf`, THEN trả `202` kèm `jobId`, và sau khi worker xử lý xong, `background_jobs.status=completed`, `media_files` có 1 record mới `fileType=EXPORT`.
- **AC-002**: GIVEN biên bản `M` có `preparedBy=A` nhưng `meeting.hostId=B` (host đã đổi), WHEN `B` gọi export, THEN trả `202` (B được phép vì là host hiện tại).
- **AC-003**: GIVEN biên bản `M` bất kỳ đang `published`, WHEN Business Admin `C` gọi export, THEN trả `202` (Admin bypass ownership).
- **AC-004**: GIVEN request export với `format=docx`, WHEN worker xử lý, THEN file `.docx` hợp lệ được tạo (mở được, không rỗng, đúng `mimeType`).
- **AC-005**: GIVEN request export KHÔNG truyền `format`/`includeTranscript`/`includeActionItems` (dùng default), WHEN worker xử lý xong, THEN `meeting_minutes.file_id` được cập nhật trỏ tới `MediaFileEntity` mới (export mặc định).
- **AC-006**: GIVEN request export với `format=docx` (khác export mặc định), WHEN worker xử lý xong, THEN `meeting_minutes.file_id` **KHÔNG** đổi (giữ nguyên giá trị trước đó, kể cả NULL).

### 7.2 Authorization Cases
- **AC-007**: GIVEN người gọi là Participant của meeting (không phải `preparedBy`/`meeting.hostId`/Admin), WHEN gọi export, THEN trả `403 NOT_MINUTES_OWNER`.
- **AC-008**: GIVEN người gọi không có permission `meeting.minutes.export`, WHEN gọi export, THEN trả `403 FORBIDDEN`.
- **AC-009**: GIVEN người gọi là System Admin, WHEN gọi export cho biên bản `published` bất kỳ, THEN trả `202` (ngang quyền Business Admin).

### 7.3 Business Rule Cases
- **AC-010**: GIVEN biên bản `M` có `status=draft`, WHEN Host gọi export, THEN trả `409 MINUTES_NOT_PUBLISHED`.
- **AC-011**: GIVEN biên bản `M` có `status=archived`, WHEN Host gọi export, THEN trả `409 MINUTES_NOT_PUBLISHED`.
- **AC-012**: GIVEN `includeTranscript=true` NHƯNG `linkedTranscriptId=NULL`, WHEN worker xử lý, THEN job vẫn `completed`, file export vẫn tạo thành công (chỉ thiếu phần transcript).

### 7.4 Validation Cases
- **AC-013**: GIVEN `id` không phải UUID hợp lệ, WHEN gọi export, THEN trả `400`.
- **AC-014**: GIVEN `format="xlsx"` (không hợp lệ cho minutes), WHEN gọi export, THEN trả `400 VALIDATION_ERROR`.
- **AC-015**: GIVEN body thiếu `format`, WHEN gọi export, THEN trả `400 VALIDATION_ERROR`.

### 7.5 State Transition / Not Found Cases
- **AC-016**: GIVEN `M` không tồn tại (`id` ngẫu nhiên hợp lệ UUID), WHEN gọi export, THEN trả `404 MINUTES_NOT_FOUND`.
- **AC-017**: GIVEN `M` đã bị xóa mềm (`deletedAt IS NOT NULL`), WHEN gọi export, THEN trả `404 MINUTES_NOT_FOUND`.

### 7.6 Job / Audit Cases
- **AC-018**: GIVEN worker gặp lỗi khi render (ví dụ dữ liệu content bị hỏng), WHEN xử lý job, THEN `background_jobs.status=failed`, `errorMessage` được set, job KHÔNG crash worker process (worker vẫn tiếp tục xử lý job tiếp theo).
- **AC-019**: GIVEN export thành công, THEN có đúng 1 `audit_logs` mới với `action_type=meeting_minutes_exported`.
- **AC-020**: GIVEN export nhiều lần liên tiếp cho cùng `minutesId` (không có idempotency-key), WHEN mỗi lần gọi export, THEN mỗi lần đều tạo 1 `background_jobs` + (sau khi hoàn tất) 1 `media_files` độc lập — không dedupe (theo đúng gap đã ghi nhận ở mục 1.5/4.3).

### 7.7 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-004 | FR-001, FR-002, FR-003, FR-012 |
| AC-002, AC-003, AC-009 | FR-004, FR-014, FR-015 |
| AC-005, AC-006 | FR-006 |
| AC-007 | FR-014 |
| AC-008 | Permission guard (mục 2.2) |
| AC-010, AC-011 | FR-009 |
| AC-012 | FR-011 |
| AC-013, AC-014, AC-015 | FR-016, FR-017 |
| AC-016, AC-017 | FR-010, FR-013 |
| AC-018 | FR-007 |
| AC-019 | FR-008 |
| AC-020 | Mục 4.3 (idempotency gap đã biết) |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Export biên bản đang `draft` (chỉ `published`).
- Notification tự động khi export xong (xem FR-023 — khác UC-146 "phân phối").
- Endpoint polling/download mới (tái dùng `background-jobs`/`media-files` sẵn có).
- Idempotency-key cho request export (gap đã biết, nhất quán với `reports` module — không phải regression riêng của feature này).
- Export cho participant thường (chỉ Host/Preparer/Admin).
- Xóa/dọn dẹp các file export cũ không còn được `file_id` trỏ tới (không có cơ chế cleanup/TTL trong phạm vi này — để dành cho 1 feature retention/cleanup riêng nếu cần).
- Watermark, chữ ký số, hoặc bảo vệ mật khẩu file PDF/Word.

### 8.2 Có thể xem xét ở feature khác
- UC-146 "Phân phối biên bản cuộc họp" — gửi file đã export cho participant/người ngoài qua email.
- Feature dọn dẹp file export cũ (media_files retention policy).
- Cho phép participant thường tự export bản họ được xem (nếu policy đổi).

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép export biên bản khi `status != published`, kể cả với Business Admin/System Admin.
- **FR-OOS-002**: THE system SHALL NOT tạo endpoint download/polling mới ngoài `GET /background-jobs/:id` và `GET /media-files/:id` đã có sẵn.
- **FR-OOS-003**: THE system SHALL NOT gửi notification tự động cho participant khác khi export hoàn tất.
- **FR-OOS-004**: THE system SHALL NOT thêm bảng hoặc cột mới vào database baseline.

## Assumptions
Xem mục 1.4 và 1.5.
