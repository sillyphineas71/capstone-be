# Feature Specification: Xem danh sách biên bản họp

- **Feature ID**: MINUTES-LIST-001
- **Feature Name**: Xem danh sách biên bản họp
- **Module / Domain**: minutes
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - UC-MKM-02 "Xem danh sách biên bản họp" (use case gốc do team cung cấp)
  - UC-MKM-06 "Lọc biên bản theo khoảng thời gian" (use case gốc do team cung cấp, 2026-07-02) — sau gap analysis, xác nhận UC này KHÔNG cần feature backend riêng vì đã được cover đầy đủ bởi FR-011/FR-029 của chính feature này (xem mục 1.6)
  - Thảo luận phân tích UC-MKM-02 với team (2026-07-02) — 2 quyết định đã chốt: (1) participant không thấy biên bản Nháp của người khác, chỉ Host tạo mới thấy; (2) SYSTEM_ADMIN được bổ sung ngang quyền BUSINESS_ADMIN ở AF2
  - `capstone-be/spec/features/minutes/feat-create-draft-meeting-minutes/spec.md` (UC-MKM-01, đã implement — nguồn cho FR-003 visibility_level=private)
  - `capstone-be/spec/features/meeting/feat-pending-meeting-requests/spec.md` (feature list tương tự dùng làm template)
  - Database v3.2 Compact (39 tables), entity `MeetingMinutesEntity`, `MeetingEntity`, `MeetingParticipantEntity`
  - AGENTS.md / CLAUDE.md backend guide
  - `.specify/templates/spec-template.md`

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo mới spec cho feature feat-list-meeting-minutes (UC-MKM-02) | Toàn bộ file |
| 2026-07-02 | Sửa 422 → 400 cho lỗi validation enum/sortBy, khớp hành vi thực tế của ValidationPipe mặc định (không có exceptionFactory tùy chỉnh trong dự án) | FR-027, FR-030, ERR-003, AC-014 |
| 2026-07-02 | Bổ sung mục 1.6 (quan hệ với UC-MKM-06 "Lọc biên bản theo khoảng thời gian") và 1 dòng traceability mới sau gap analysis: UC-MKM-06 không cần feature backend riêng, đã được cover đầy đủ bởi FR-011 (filter from/to) + FR-029 (validate from>to) đã có sẵn trong feature này. Không có thay đổi hành vi/API nào | Source Documents, mục 1.6 (mới), mục 3.9 Traceability |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Feature này cung cấp API đọc danh sách biên bản họp (`meeting_minutes`) cho Internal Employee (Host/Participant), Manager, Business Admin và System Admin, theo UC-MKM-02.

Feature `feat-create-draft-meeting-minutes` (UC-MKM-01) đã implement việc tạo biên bản Nháp với `status = draft`, `visibility_level = private` (ghi đè cứng, chỉ Host tạo ra mới thấy). Chưa có feature nào publish biên bản (chuyển `draft` → `published`), nên trong toàn bộ dữ liệu hiện tại, mọi biên bản đều đang ở trạng thái `draft`/`private`. Feature liệt kê danh sách này phải thiết kế đúng theo mô hình quyền đã có (`status` + `visibility_level`), sẵn sàng hoạt động đúng khi feature publish được bổ sung sau này, thay vì chỉ dựa theo danh sách khách mời cuộc họp như mô tả đơn giản ban đầu trong UC gốc.

Feature này thuộc module `minutes`, giai đoạn sau cuộc họp (post-meeting) trong meeting lifecycle.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Internal Employee (Host/Participant), Manager, Business Admin, System Admin xem và tra cứu danh sách biên bản họp mà họ có quyền truy cập, với bộ lọc và phân trang, để nắm được lịch sử biên bản của tổ chức hoặc cá nhân.

### 1.3 Giá trị mang lại

- Giúp nhân viên tra cứu lại biên bản các cuộc họp mình đã tham dự/chủ trì.
- Giúp Business Admin/System Admin có cái nhìn tổng quan toàn bộ biên bản của tổ chức phục vụ audit/quản trị.
- Chuẩn hóa cơ chế phân quyền hiển thị dữ liệu nhạy cảm (biên bản họp) theo đúng model `status`/`visibility_level` đã có trong DB, tránh rò rỉ bản Nháp riêng tư.

### 1.4 Giả định

- Permission `meeting.minutes.read` chưa tồn tại trong DB, cần seed mới (theo đúng cơ chế migration, xem research.md mục 1.6).
- Hiện tại toàn bộ biên bản trong hệ thống có `status = draft` và `visibility_level = private` vì chưa có feature publish. Feature này vẫn phải implement đúng theo toàn bộ state model (`draft/published/archived/deleted`) để không cần sửa lại khi feature publish ra đời.
- `visibility_level = department` và `public_internal` chưa có producer nào (không feature nào set 2 giá trị này). Xử lý 2 giá trị này được coi là forward-compatible, không phải core scope — xem mục 1.5.
- API tuân thủ convention `/api/v1`, response chuẩn `success/data/meta/error`.
- Không ghi audit log cho hành động đọc dữ liệu (GET), theo đúng convention của `feat-pending-meeting-requests`.

### 1.5 Cần làm rõ

- **[ĐÃ GIẢI QUYẾT]** Participant có thấy biên bản Nháp (draft/private) của Host không? → Không. Chỉ Host tạo ra biên bản mới thấy bản Nháp của chính mình. Xem FR-014, FR-015.
- **[ĐÃ GIẢI QUYẾT]** AF2 (xem toàn bộ) áp dụng cho role nào? → Cả `BUSINESS_ADMIN` và `SYSTEM_ADMIN`, nhất quán với toàn bộ RBAC hiện có của dự án (transcription, background-jobs, meeting-end đều check chung 2 role này). Xem FR-016.
- **[DEFER]** `visibility_level = department` / `public_internal`: chưa có feature nào produce 2 giá trị này (chỉ `private` được set qua feat-create-draft-meeting-minutes). Feature này xử lý an toàn (fail-closed): nếu gặp 2 giá trị này trên biên bản `published`/`archived`, áp dụng cùng rule như `participants` (chỉ host/participant thấy) cho đến khi có feature publish/chia sẻ định nghĩa rõ ràng hành vi mong muốn. Không tự phát minh rule mở rộng hơn.
- **[DEFER]** Feature "Publish biên bản" (chuyển `draft` → `published`, cập nhật `visibility_level`) chưa tồn tại, nằm ngoài phạm vi feature này (xem mục 8).

### 1.6 Quan hệ với UC-MKM-06 "Lọc biên bản theo khoảng thời gian"

Sau khi UC-MKM-06 được đưa ra để lên spec, gap analysis cho thấy toàn bộ nghiệp vụ của UC đó đã được feature này cover 100%, không cần tạo feature backend riêng:

| Yêu cầu trong UC-MKM-06 | Đã cover ở đâu trong feature này |
| :--- | :--- |
| Lọc theo khoảng thời gian `from`/`to` (Normal Flow bước 3-5) | **FR-011**: filter theo `meeting.actual_start_time` khi client truyền `from`/`to` |
| Kết hợp với điều kiện phân quyền (Normal Flow bước 5) | Scope theo role (mục 2.2) luôn áp dụng TRƯỚC filter, filter chỉ AND thêm vào — đã đúng theo FR-007 |
| Validate `from > to` là lỗi | **FR-029/ERR-005**: `400 Invalid date range` |
| Không có kết quả → trả rỗng, không lỗi (EX2 của UC-MKM-06) | Cùng cơ chế **AC-013**: trả `200` với `data=[]`, `meta.total=0` |
| Xóa filter, tải lại toàn bộ danh sách (AF2 của UC-MKM-06) | Chỉ cần FE không gửi `from`/`to` — code hiện tại (`if (queryDto.from && queryDto.to)`) tự động bỏ qua điều kiện filter khi thiếu tham số, không cần API riêng |

Toàn bộ phần còn lại của UC-MKM-06 (Date Range Picker UI, nút "X" clear filter, dựng câu thông báo "Không tìm thấy biên bản... từ [ngày] đến [ngày]") là UI/UX thuần của FE, không cần thay đổi API/business logic ở BE. Xem thêm dòng traceability UC-MKM-06 ở mục 3.9.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| INTERNAL_USER (Host) | Xem biên bản mình chủ trì, gồm cả bản Nháp do mình tạo | Cần permission `meeting.minutes.read` |
| INTERNAL_USER (Participant) | Xem biên bản đã `published`/`archived` của các cuộc họp mình tham dự | Cần permission `meeting.minutes.read` |
| MANAGER | Xem như Internal Employee (Host/Participant), không có scope mở rộng trong feature này | Cần permission `meeting.minutes.read` |
| BUSINESS_ADMIN | Xem toàn bộ biên bản của tổ chức (mọi status trừ `deleted`, không giới hạn theo participant/host) | Cần permission `meeting.minutes.read` |
| SYSTEM_ADMIN | Xem toàn bộ biên bản của tổ chức, ngang quyền BUSINESS_ADMIN | Cần permission `meeting.minutes.read` |

### 2.2 Role & Permission Rules

- User có permission `meeting.minutes.read` được phép gọi API này.
- `BUSINESS_ADMIN`, `SYSTEM_ADMIN`: bỏ qua ràng buộc participant/host và bỏ qua ràng buộc `visibility_level = private`, thấy toàn bộ biên bản có `status IN (draft, published, archived)` (loại trừ `deleted`).
- Actor khác (`INTERNAL_USER`, `MANAGER`): 
  - Thấy biên bản `status = draft` CHỈ KHI `prepared_by = currentUser.id` (chính mình tạo).
  - Thấy biên bản `status IN (published, archived)` CHỈ KHI (`meeting.host_id = currentUser.id` HOẶC tồn tại bản ghi `meeting_participants` với `user_id = currentUser.id` cho `meeting_id` tương ứng).
  - Không bao giờ thấy `status = deleted` (soft-deleted), kể cả admin.

### 2.3 Actor Constraints

- Phải đăng nhập (authenticated) trước khi truy cập API.
- Phải có permission `meeting.minutes.read`.
- Scope constraint áp dụng sau permission check (permission chỉ xác định được gọi API, không xác định thấy được bản ghi nào).
- Nếu không có biên bản nào trong scope, trả 200 với `data = []` (không lỗi, không fallback toàn tổ chức).

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)

```text
FR-001: THE system SHALL yêu cầu người dùng đăng nhập trước khi truy cập API danh sách biên bản họp.
FR-002: THE system SHALL yêu cầu người dùng có permission meeting.minutes.read để truy cập API này.
FR-003: THE system SHALL trả về danh sách biên bản họp dựa trên bảng meeting_minutes của Database v3.2 Compact.
FR-004: THE system SHALL loại trừ mọi biên bản có status = deleted (soft-delete) khỏi mọi kết quả trả về, không phân biệt actor.
FR-005: THE system SHALL hỗ trợ phân trang với các tham số page, limit, sortBy, sortOrder.
FR-006: THE system SHALL giới hạn limit tối đa là 20 bản ghi trên một trang, theo Business Rule BR2 của UC-MKM-02 (khác với giới hạn mặc định 100 của các API danh sách khác trong dự án).
```

### 3.2 Event-driven Requirements (Query & Response)

```text
FR-007: WHEN client gửi request GET /api/v1/meeting-minutes, THE system SHALL áp dụng scope theo role trước, sau đó áp dụng các bộ lọc theo query parameters.
FR-008: WHEN client truyền status, THE system SHALL lọc theo giá trị tương ứng trong tập draft, published, archived, all — luôn áp dụng SAU khi đã áp dụng scope theo role (mục 2.2), không mở rộng thêm quyền truy cập.
FR-009: WHEN client không truyền status, THE system SHALL trả về mọi status mà actor đó có quyền thấy theo scope (không mặc định ẩn draft/archived nếu actor có quyền thấy).
FR-010: WHEN client truyền roomId, THE system SHALL lọc các biên bản có meeting.room_id tương ứng.
FR-011: WHEN client truyền from và/hoặc to, THE system SHALL lọc các biên bản có meeting.actual_start_time nằm trong khoảng thời gian tương ứng.
FR-012: WHEN client truyền q, THE system SHALL tìm kiếm case-insensitive, partial match trên minutes.title HOẶC meeting.title HOẶC host.full_name.
FR-013: WHEN trả danh sách, THE system SHALL bao gồm thông tin phòng họp (room) là null nếu meeting.meeting_mode = online hoặc meeting.room_id = null, thay vì báo lỗi.
```

### 3.3 State-driven Requirements (Scope theo role)

```text
FR-014: WHILE người dùng là INTERNAL_USER hoặc MANAGER, THE system SHALL chỉ hiển thị biên bản status = draft khi minutes.prepared_by = currentUser.id.
FR-015: WHILE người dùng là INTERNAL_USER hoặc MANAGER, THE system SHALL chỉ hiển thị biên bản status IN (published, archived) khi currentUser là host của meeting liên quan HOẶC có mặt trong meeting_participants của meeting đó.
FR-016: WHILE người dùng là BUSINESS_ADMIN hoặc SYSTEM_ADMIN, THE system SHALL cho phép xem toàn bộ biên bản có status IN (draft, published, archived) không giới hạn theo participant/host/visibility_level.
```

### 3.4 Sorting Requirements

```text
FR-017: WHEN client không truyền sortBy và sortOrder, THE system SHALL mặc định sort theo meeting.actual_start_time DESC (thời gian họp thực tế gần nhất trước).
FR-018: WHEN client truyền sortBy, THE system SHALL kiểm tra giá trị trong allowlist trước khi áp dụng.
FR-019: THE system SHALL chỉ cho phép sort theo các field: actual_start_time, created_at.
```

### 3.5 Response & Relation Requirements

```text
FR-020: WHEN trả danh sách biên bản, THE system SHALL bao gồm các field chính: id, title, status, versionNo, createdAt.
FR-021: WHEN trả danh sách biên bản, THE system SHALL bao gồm relation summary meeting: id, title, actualStartTime, actualEndTime, meetingMode, room (id, roomName hoặc null).
FR-022: WHEN trả danh sách biên bản, THE system SHALL bao gồm relation summary host: id, fullName, email, lấy từ meeting.host_id (không phải minutes.prepared_by).
FR-023: IF meeting.host_id là null, THEN THE system SHALL trả host = null thay vì làm lỗi response.
FR-024: THE system SHALL load relations bằng TypeORM QueryBuilder với LEFT JOIN, tránh N+1 query.
```

### 3.6 Validation Requirements

```text
FR-025: IF page < 1, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-026: IF limit < 1 hoặc limit > 20, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-027: IF status không nằm trong danh sách hợp lệ (draft, published, archived, all), THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-028: IF roomId không phải UUID hợp lệ, THEN THE system SHALL trả về lỗi 400 Bad Request.
FR-029: IF from > to, THEN THE system SHALL trả về lỗi 400 Invalid date range.
FR-030: IF sortBy không nằm trong allowlist, THEN THE system SHALL trả về lỗi 400 Invalid sort field.
```

### 3.7 Authorization Requirements

```text
FR-031: IF user không có permission meeting.minutes.read, THEN THE system SHALL trả về 403 Forbidden.
FR-032: IF không có biên bản nào trong scope của actor, THEN THE system SHALL trả về 200 với data = [] (không lỗi).
```

### 3.8 Performance & Data Requirements

```text
FR-033: THE system SHALL đảm bảo query index-friendly, tận dụng index có sẵn trên meeting_minutes (status) và meetings (host_id, room_id, actual_start_time).
FR-034: THE system SHALL không trả minutes_content, decisions_json, action_items_json, attendees_snapshot_json trong response danh sách (chỉ trả ở API xem chi tiết, ngoài phạm vi feature này).
FR-035: THE system SHALL không ghi audit_log cho hành động đọc dữ liệu (GET).
```

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-MKM-02 PRE-1 | Authentication |
| FR-002 | Ubiquitous | UC-MKM-02 (bổ sung sau thảo luận) | Permission meeting.minutes.read |
| FR-004 | Ubiquitous | UC-MKM-02 (điểm cần làm rõ #3) | Loại trừ status=deleted |
| FR-006 | Ubiquitous | UC-MKM-02 BR2 | Pagination tối đa 20/trang |
| FR-014, FR-015 | State-driven | Thảo luận phân tích UC-MKM-02 (quyết định #1) | Draft chỉ Host thấy |
| FR-016 | State-driven | Thảo luận phân tích UC-MKM-02 (quyết định #2) | SYSTEM_ADMIN ngang BUSINESS_ADMIN |
| FR-012 | Event-driven | UC-MKM-02 AF1 | Tìm theo tiêu đề/tên cuộc họp/tên host |
| FR-013 | Event-driven | UC-MKM-02 (điểm cần làm rõ #4) | Xử lý meeting online không có phòng |
| FR-022 | Response | UC-MKM-02 (điểm cần làm rõ #5) | Hiển thị meeting.host, không phải preparedBy |
| FR-011, FR-029 | Event-driven / Validation | UC-MKM-06 "Lọc biên bản theo khoảng thời gian" | Date range filter (from/to) + validate from>to — cover đầy đủ UC-MKM-06, không cần feature riêng (xem mục 1.6) |

---

## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL trả response danh sách biên bản họp trong vòng 3 giây dưới tải bình thường (dưới 10.000 bản ghi).
NFR-002: THE system SHALL sử dụng database index trên các field thường dùng để lọc/join (status, host_id, room_id, actual_start_time).
```

### 4.2 Security

```text
NFR-003: THE system SHALL yêu cầu authentication trước khi cho phép truy cập API.
NFR-004: THE system SHALL kiểm tra authorization (permission meeting.minutes.read) cho mỗi request.
NFR-005: THE system SHALL không tiết lộ nội dung biên bản (minutes_content) hoặc dữ liệu nhạy cảm khác trong response danh sách.
NFR-006: THE system SHALL validate sortBy theo allowlist để tránh SQL/QueryBuilder injection.
```

### 4.3 Reliability & Consistency

```text
NFR-007: THE system SHALL trả pagination meta (page, limit, total, totalPages) chính xác.
NFR-008: THE system SHALL đảm bảo scope filtering không bao giờ rò rỉ biên bản status=draft của người khác cho actor không phải admin.
```

### 4.4 Usability

```text
NFR-009: THE system SHALL trả error message rõ ràng, có thể hiểu được bởi client.
NFR-010: THE system SHALL sử dụng response format thống nhất theo project convention (success/data/meta/error).
```

### 4.5 Maintainability

```text
NFR-011: THE system SHALL giữ business logic trong module minutes, không trộn lẫn với module meetings.
NFR-012: THE system SHALL cung cấp test cases cho success flow, scope filtering theo từng role, validation failure, authorization failure.
```

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| meeting_minutes | Bảng chính chứa dữ liệu biên bản | status, visibility_level, prepared_by, meeting_id |
| meetings | Relation: meeting summary + scope (host_id) | LEFT JOIN, chỉ lấy id, title, actual_start_time, actual_end_time, meeting_mode, room_id, host_id |
| meeting_participants | Dùng để kiểm tra scope (currentUser có phải participant không) | LEFT JOIN/EXISTS theo meeting_id + user_id |
| rooms | Relation: room summary | LEFT JOIN, chỉ lấy id, room_name |
| users | Relation: host summary | LEFT JOIN qua meeting.host_id, chỉ lấy id, full_name, email |

### 5.2 Query Parameters (đầu vào)

| Parameter | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| page | integer | Không (mặc định 1) | Số trang | >= 1 |
| limit | integer | Không (mặc định 20) | Số lượng item/trang | 1 <= limit <= 20 (BR2) |
| status | string | Không | Trạng thái biên bản | draft, published, archived, all |
| roomId | uuid | Không | ID phòng họp | UUID valid |
| from | ISO 8601 | Không | Thời gian bắt đầu (meeting.actual_start_time) | from <= to |
| to | ISO 8601 | Không | Thời gian kết thúc (meeting.actual_start_time) | from <= to |
| q | string | Không | Từ khóa tìm kiếm | Tìm theo minutes.title, meeting.title, host.full_name |
| sortBy | string | Không (mặc định actual_start_time) | Field để sort | Allowlist: actual_start_time, created_at |
| sortOrder | string | Không (mặc định desc) | Thứ tự sort | asc, desc |

### 5.3 Response Data (đầu ra)

Mỗi item trong danh sách:

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| id | uuid | ID của biên bản |
| title | string | Tiêu đề biên bản |
| status | string | draft, published, archived |
| versionNo | integer | Số phiên bản |
| createdAt | ISO 8601 | Thời điểm tạo biên bản |
| meeting | object | id, title, actualStartTime, actualEndTime, meetingMode, room (object hoặc null) |
| host | object (null) | id, fullName, email — null nếu meeting.host_id null |

### 5.4 State / Status Model

`meeting_minutes.status`:

| Status | Ý nghĩa | Hiển thị cho ai |
|---|---|---|
| draft | Bản nháp, visibility_level=private | Chỉ prepared_by (Host tạo ra) hoặc Admin |
| published | Đã phát hành chính thức | Host/participant của meeting + Admin |
| archived | Đã lưu trữ | Host/participant của meeting + Admin |
| deleted | Đã xóa mềm | Không ai thấy (loại trừ khỏi mọi query) |

### 5.5 Data Constraints

- Không thêm cột/bảng mới. Toàn bộ field đã có sẵn trong baseline DB v3.2 Compact.
- Scope filtering là AND kết hợp với các filter khác (status/roomId/from-to/q), không OR với chúng.
- `meeting.room_id` có thể null (meeting online) — response phải trả `room = null`, không lỗi.

### 5.6 Data Lifecycle

- **Đọc**: Feature này chỉ đọc dữ liệu, không thay đổi `meeting_minutes`, `meetings`, hay bảng nào khác.
- Vòng đời tạo/publish/archive/xóa biên bản thuộc các feature khác (feat-create-draft-meeting-minutes đã có; publish/archive/delete ngoài phạm vi, xem mục 8).

### 5.7 Cần làm rõ

- [ĐÃ GIẢI QUYẾT] Xem mục 1.5.

---

## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF page < 1, THEN THE system SHALL trả về 400 Bad Request.
ERR-002: IF limit < 1 hoặc limit > 20, THEN THE system SHALL trả về 400 Bad Request.
ERR-003: IF status không nằm trong danh sách hợp lệ, THEN THE system SHALL trả về 400 Bad Request.
ERR-004: IF roomId không phải UUID hợp lệ, THEN THE system SHALL trả về 400 Bad Request.
ERR-005: IF from > to, THEN THE system SHALL trả về 400 Invalid date range.
ERR-006: IF sortBy không nằm trong allowlist, THEN THE system SHALL trả về 400 Invalid sort field.
```

> Ghi chú: Dự án dùng `ValidationPipe` mặc định (không có `exceptionFactory` tùy chỉnh) cho toàn bộ API list hiện có (xem `meeting-requests.controller.ts`), nên mọi lỗi validate DTO (kể cả enum không hợp lệ) đều trả `400 Bad Request`, không phân biệt 422 như một số spec khác từng ghi. Feature này bám theo hành vi runtime thực tế thay vì tài liệu hóa một mã lỗi 422 chưa từng được implement.

### 6.2 Authentication / Authorization Errors

```text
ERR-007: IF user chưa đăng nhập (không có JWT token hợp lệ), THEN THE system SHALL trả về 401 Unauthorized.
ERR-008: IF user không có permission meeting.minutes.read, THEN THE system SHALL trả về 403 Forbidden.
```

### 6.3 System Failure Errors

```text
ERR-009: IF database query thất bại hoặc timeout, THEN THE system SHALL trả về 500 Internal Server Error.
```

### 6.4 Error Response Expectations

| Field | Mô tả |
|---|---|
| success | false |
| message | Thông báo lỗi có thể diễn giải |
| error.code | Mã lỗi nội bộ |
| error.details | Chi tiết lỗi validation nếu cần |
| timestamp | Thời điểm xảy ra lỗi |
| path | API path |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001: Host xem được biên bản Nháp của chính mình
Given Host đã tạo 1 biên bản status=draft cho meeting mình chủ trì,
When Host gọi GET /api/v1/meeting-minutes,
Then response trả về biên bản đó trong danh sách.
```

```text
AC-002: Participant KHÔNG thấy biên bản Nháp của Host
Given meeting có 1 biên bản status=draft do Host tạo (prepared_by=Host), currentUser là participant (không phải Host) của meeting đó,
When participant gọi GET /api/v1/meeting-minutes,
Then response KHÔNG chứa biên bản đó.
```

```text
AC-003: Participant thấy biên bản đã published của meeting mình tham dự
Given meeting có 1 biên bản status=published, currentUser có mặt trong meeting_participants của meeting đó,
When participant gọi GET /api/v1/meeting-minutes,
Then response trả về biên bản đó.
```

```text
AC-004: Business Admin xem toàn bộ biên bản kể cả Nháp của người khác
Given hệ thống có nhiều biên bản với status khác nhau do nhiều Host khác nhau tạo,
When Business Admin gọi GET /api/v1/meeting-minutes,
Then response trả về toàn bộ biên bản (draft + published + archived), không giới hạn theo participant/host.
```

```text
AC-005: System Admin có quyền ngang Business Admin
Given hệ thống có nhiều biên bản,
When System Admin gọi GET /api/v1/meeting-minutes,
Then response trả về toàn bộ biên bản giống hệt Business Admin.
```

### 7.2 Authorization Cases

```text
AC-006: User không có permission meeting.minutes.read bị từ chối
Given user không có permission meeting.minutes.read,
When user gửi GET /api/v1/meeting-minutes,
Then hệ thống trả 403 Forbidden.
```

### 7.3 Filter & Search Cases

```text
AC-007: Filter theo status=archived chỉ trả biên bản đã lưu trữ
Given hệ thống có biên bản published và archived mà currentUser có quyền thấy,
When client gửi GET /api/v1/meeting-minutes?status=archived,
Then response chỉ trả biên bản status=archived.
```

```text
AC-008: Tìm kiếm theo q khớp tiêu đề biên bản, tên cuộc họp hoặc tên host
Given có biên bản với title/meeting.title/host.fullName chứa từ khóa,
When client gửi GET /api/v1/meeting-minutes?q=<keyword>,
Then response chỉ trả các biên bản khớp ít nhất 1 trong 3 field, case-insensitive.
```

```text
AC-009: Meeting online (room_id null) vẫn trả response hợp lệ
Given một biên bản có meeting.meeting_mode=online, meeting.room_id=null,
When client gửi GET /api/v1/meeting-minutes,
Then response trả room=null trong meeting summary, không lỗi.
```

### 7.4 Pagination & Sort Cases

```text
AC-010: Pagination tối đa 20/trang theo BR2
Given hệ thống có 50 biên bản trong scope của currentUser,
When client gửi GET /api/v1/meeting-minutes?page=1&limit=20,
Then response trả 20 items trên trang 1, meta.total=50, meta.totalPages=3.
```

```text
AC-011: limit vượt quá 20 bị reject
Given client gửi limit=50,
When client gửi GET /api/v1/meeting-minutes?limit=50,
Then hệ thống trả 400 Bad Request.
```

```text
AC-012: Sort mặc định theo actualStartTime DESC
Given hệ thống có nhiều biên bản với meeting.actual_start_time khác nhau,
When client gọi GET /api/v1/meeting-minutes không truyền sortBy,
Then response sort theo meeting.actual_start_time giảm dần.
```

### 7.5 Empty & Validation Cases

```text
AC-013: Không có biên bản nào trong scope trả 200 rỗng
Given currentUser không phải host/participant của bất kỳ meeting nào có biên bản,
When client gửi GET /api/v1/meeting-minutes,
Then hệ thống trả 200 với data=[], meta.total=0.
```

```text
AC-014: status không hợp lệ trả lỗi validation chuẩn
Given client gửi status không nằm trong enum hợp lệ,
When client gửi GET /api/v1/meeting-minutes?status=invalid,
Then hệ thống trả 400 Bad Request.
```

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-014 | Host xem draft của mình |
| AC-002 | FR-014, FR-015, NFR-008 | Participant không thấy draft người khác |
| AC-003 | FR-015 | Participant thấy published |
| AC-004 | FR-016 | Business Admin xem toàn bộ |
| AC-005 | FR-016 | System Admin ngang Business Admin |
| AC-006 | FR-002, FR-031, ERR-008 | Không có permission |
| AC-007 | FR-008 | Filter status |
| AC-008 | FR-012 | Search q |
| AC-009 | FR-013, FR-023 | Meeting online null room |
| AC-010 | FR-005, FR-006 | Pagination BR2 |
| AC-011 | FR-026, ERR-002 | Limit vượt max |
| AC-012 | FR-017 | Sort mặc định |
| AC-013 | FR-032 | Scope rỗng |
| AC-014 | FR-027, ERR-003 | Invalid enum |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Không tạo/sửa/xóa/publish/archive biên bản họp (thuộc feature khác).
- Không xem chi tiết một biên bản đơn lẻ (GET /api/v1/meeting-minutes/:id) — bao gồm minutes_content, decisions_json, action_items_json.
- Không export danh sách ra file.
- Không thống kê/dashboard số lượng biên bản.
- Không gửi notification.
- Không tạo migration thay đổi schema (chỉ seed permission).
- Không implement logic hiển thị badge màu (đây là trách nhiệm của FE dựa trên field `status`).
- Không xử lý rule mở rộng riêng cho `visibility_level = department` / `public_internal` ngoài fallback fail-closed đã nêu ở mục 1.5.

### 8.2 Có thể xem xét ở feature khác

- Feature "Publish biên bản" (chuyển draft → published, đổi visibility_level).
- Chi tiết một biên bản (GET /api/v1/meeting-minutes/:id).
- Export danh sách biên bản ra Excel/PDF.
- Định nghĩa đầy đủ hành vi `visibility_level = department` / `public_internal` khi có feature chia sẻ biên bản ở phạm vi rộng hơn participant.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tạo, cập nhật, publish, archive, hoặc xóa bất kỳ bản ghi meeting_minutes nào trong feature này.
OOS-002: THE system SHALL NOT trả về minutes_content, decisions_json, action_items_json, attendees_snapshot_json trong response danh sách.
OOS-003: THE system SHALL NOT thêm bảng hoặc cột database mới.
OOS-004: THE system SHALL NOT implement single minutes detail endpoint (GET /api/v1/meeting-minutes/:id) trong feature này.
OOS-005: THE system SHALL NOT gửi notification hoặc ghi audit log trong feature này.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Functional Requirements đã dùng EARS.
- [x] Có đủ 5 EARS patterns: Ubiquitous, Event-driven, State-driven, Unwanted Behavior, Authorization.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Có đủ validation, authorization, response relation requirements.
- [x] Đã xử lý null relation cho host và room.
- [x] Có pagination (BR2: max 20), sorting, filtering requirements.
- [x] Không tự ý thêm bảng mới.
- [x] Không triển khai out-of-scope nội dung.
- [x] Có AC traceability.
- [x] Có Out of Scope rõ ràng.
- [x] Các điểm cần làm rõ từ thảo luận UC-MKM-02 đã được đưa vào mục 1.5 với trạng thái đã giải quyết/deferred.
