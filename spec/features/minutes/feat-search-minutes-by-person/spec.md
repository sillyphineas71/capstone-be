# Feature Specification: Tìm kiếm biên bản theo nhân sự (Search Meeting Minutes by Person)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-07 (khớp UC-135 trong API_CONTRACT_v1.0_with_system_roles.md), sau vòng thảo luận + Q&A trực tiếp với Product Owner để chốt model phân quyền theo phòng ban | Toàn bộ file |

> Nguồn gốc: UC-MKM-07 "Tìm kiếm biên bản theo nhân sự" (Feature Table gốc, do người dùng cung cấp trực tiếp) + UC-135 "Tìm kiếm biên bản theo nhân sự" trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (dòng 4436-4446, gợi ý `?userId=uuid` tìm biên bản có userId trong participants hoặc prepared_by). Spec này khác biệt căn bản với `feat-list-meeting-minutes` (UC-MKM-02): UC-MKM-02 là tự xem biên bản liên quan tới **chính người gọi**, còn UC-MKM-07 là Manager/Business Admin tra cứu biên bản liên quan tới **một nhân sự khác**, với rule phân quyền theo phòng ban chưa từng có tiền lệ trong hệ thống — xem `research.md` để biết toàn bộ quá trình phân tích/Q&A.

## 1. Context & Goal

### 1.1 Bối cảnh
Business Admin hoặc Manager đôi khi cần tra cứu toàn bộ lịch sử biên bản họp liên quan tới 1 nhân sự cụ thể (ví dụ: phục vụ đánh giá hiệu suất, điều tra nội bộ, bàn giao công việc). Đây là nhu cầu tra cứu **về người khác**, khác hẳn `feat-list-meeting-minutes` (chỉ cho xem biên bản liên quan tới chính người gọi request).

### 1.2 Mục tiêu
Cung cấp 1 endpoint `GET` riêng biệt cho phép Manager (giới hạn theo phòng ban mình quản lý) hoặc Business Admin/System Admin (không giới hạn) tra cứu toàn bộ biên bản họp mà 1 nhân sự chỉ định có liên quan (là participant hoặc là người soạn thảo), có phân trang.

### 1.3 Giá trị mang lại
- Hỗ trợ Manager/Admin tra cứu nhanh lịch sử tham gia họp của 1 nhân sự mà không phải lọc thủ công qua danh sách toàn công ty.
- Tách biệt rõ ràng 2 mô hình phân quyền (tự xem vs tra cứu người khác), tránh làm phức tạp hóa logic của `feat-list-meeting-minutes` đã ổn định.

### 1.4 Giả định
- Tái sử dụng endpoint tìm kiếm/autocomplete nhân sự đã có sẵn: `GET /api/v1/users` (module `accounts`, permission `accounts.user.list`, hỗ trợ tìm theo tên/email, trả `id/fullName/email`) cho bước 3-4 của Normal Flow (Người dùng gõ tên/email, hệ thống gợi ý). Feature này **không** xây dựng lại autocomplete — chỉ cần FE gọi `GET /api/v1/users?q=...` rồi lấy `id` làm `userId` truyền vào endpoint mới.
- "Phòng ban do Manager phụ trách" = các dòng `departments` có `manager_user_id = <managerId>` (đúng nghĩa đen BR1 của UC gốc) — **không** dùng pattern `users.direct_manager_id` đã có sẵn ở module `attendance` (`AttendanceService.checkAccess`/`getDirectReportIds`), vì đó là mô hình "quản lý trực tiếp 1 cấp theo từng participant", khác hẳn "phụ trách phòng ban" mà UC-MKM-07 mô tả.
- "Cuộc họp thuộc phạm vi phòng ban" được suy ra gián tiếp (vì bảng `meetings` không có cột `department_id`): ưu tiên `meeting.host.departmentId`; nếu `meeting.hostId IS NULL`, dùng `meeting.organizer.departmentId` (vì `organizer_id` luôn bắt buộc có giá trị). Đây là suy luận gián tiếp có chủ đích, không phải model chính xác 100% (một cuộc họp có thể có participant khác phòng ban vẫn tính theo phòng ban của host/organizer).
- Không tính đệ quy phòng ban con (`departments.parent_department_id`) — Manager chỉ thấy đúng (các) phòng ban mà mình là `manager_user_id` trực tiếp, không tự động thấy phòng ban con.
- Endpoint này **không thay thế** `feat-list-meeting-minutes` — 2 endpoint tồn tại song song, phục vụ 2 mục đích khác nhau (tự xem vs tra cứu người khác).

### 1.5 Cần làm rõ — đã giải quyết qua Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] Model phân quyền Manager**: dùng `departments.manager_user_id` (không dùng `direct_manager_id` của attendance module) — xem mục 1.4.
- **[ĐÃ GIẢI QUYẾT] Suy luận phòng ban của cuộc họp**: `host.departmentId`, fallback `organizer.departmentId` nếu host null — xem mục 1.4.
- **[ĐÃ GIẢI QUYẾT] Không đệ quy phòng ban con** — giữ đơn giản, có thể mở rộng sau nếu cần.
- **[ĐÃ GIẢI QUYẾT] "Nhân sự liên quan"** = nhân sự là `participant` (qua `meeting_participants`) HOẶC là `prepared_by` của chính `meeting_minutes` đó (theo đúng gợi ý UC-135).
- **[ĐÃ GIẢI QUYẾT] Biên bản `draft` có hiển thị cho Manager không?** Không — Manager chỉ thấy `published`/`archived` của nhân sự đang tra cứu, giữ nguyên rule privacy đã thiết lập ở `feat-list-meeting-minutes` (draft chỉ `prepared_by` chính chủ hoặc Admin thấy). Business Admin/System Admin vẫn thấy cả `draft` (nhất quán quyền admin đã có).
- **[ĐÃ GIẢI QUYẾT] Thiết kế endpoint**: tách **endpoint riêng** `GET /api/v1/meeting-minutes/search-by-person`, không nhồi thêm query param vào `GET /api/v1/meeting-minutes` hiện có — vì 2 endpoint có 2 chế độ phân quyền khác nhau hoàn toàn (tự xem vs tra cứu người khác), gộp chung dễ gây lỗi rò rỉ quyền.
- **[ĐÃ GIẢI QUYẾT] Permission riêng**: `meeting.minutes.search_by_person`, chỉ cấp cho `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` — **không cấp `INTERNAL_USER`** (khác toàn bộ permission `minutes.*` trước đó vốn cấp rộng cho cả 4 role), vì Primary Actor của UC gốc chỉ liệt kê Manager/Approver + Business Admin.
- **[ĐÃ GIẢI QUYẾT] System Admin ngang Business Admin** (nhất quán RBAC toàn module `minutes`).
- **[ĐÃ GIẢI QUYẾT] EX1 (không tìm thấy nhân sự)**: BE validate `userId` tồn tại và chưa xóa mềm trong `users` → `404 USER_NOT_FOUND` nếu không hợp lệ. (Trong luồng UI bình thường, FE chỉ cho phép chọn từ danh sách gợi ý nên EX1 khó xảy ra, nhưng API vẫn phải validate phòng trường hợp `userId` cũ/đã bị xóa.)
- **[ĐÃ GIẢI QUYẾT] Manager tra cứu ngoài phạm vi phòng ban**: KHÔNG trả lỗi 403 — chỉ trả `200` với `data=[]` (đúng tinh thần BR1 "chỉ thấy NẾU thuộc phạm vi"; nằm ngoài phạm vi thì tự nhiên rỗng qua điều kiện WHERE department scope, không cần code chặn riêng).
- **[ĐÃ GIẢI QUYẾT] "Manager / Approver" trong Primary Actor** = role `MANAGER` sẵn có trong RBAC (`approver` chỉ là 1 giá trị `participant_role` cấp-cuộc-họp, không phải actor/role hệ thống riêng).
- **[DEFER]** Filter theo `status`/`from`/`to`/`sortBy` bổ sung cho endpoint mới — feature này chỉ trả kết quả mặc định sort theo `actual_start_time DESC`, phân trang tối đa 20/trang (tái dùng BR2 của UC-MKM-02). Không thêm filter phụ để giữ MVP đơn giản; có thể bổ sung ở phiên bản sau nếu cần (xem mục 8).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò `MANAGER` — giới hạn theo (các) phòng ban mình là `manager_user_id`.
- **Primary Actor**: Business Admin, System Admin — không giới hạn phạm vi.
- Secondary Actor: Không có. `INTERNAL_USER` (nhân viên thường, không phải Manager) **không** phải actor của use case này.

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.search_by_person` (module_code=`minutes`, action_code=`minutes.search_by_person`).
- Role được cấp: **chỉ** `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` — không cấp `INTERNAL_USER` (xem mục 1.5).
- Sở hữu permission là điều kiện cần nhưng chưa đủ với `MANAGER`: service còn áp dụng scope theo phòng ban (mục 2.3). Với `BUSINESS_ADMIN`/`SYSTEM_ADMIN`, permission là đủ (không giới hạn phạm vi).

### 2.3 Actor Constraints
- `MANAGER` chỉ thấy biên bản (`published`/`archived`) của nhân sự đang tra cứu, NẾU cuộc họp liên quan thuộc (các) phòng ban mà `MANAGER` là `manager_user_id` (không đệ quy phòng ban con).
- `MANAGER` không phải `manager_user_id` của bất kỳ phòng ban nào (dữ liệu `departments.manager_user_id` không trỏ tới họ) → luôn nhận `data=[]`, không lỗi.
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` thấy toàn bộ biên bản (mọi status trừ `deleted`) liên quan tới nhân sự đang tra cứu, không giới hạn phòng ban.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL trả về danh sách `meeting_minutes` mà nhân sự chỉ định (`userId`) có liên quan — là `participant` (qua `meeting_participants.userId`) HOẶC là `preparedBy` của chính biên bản.
- **FR-002**: THE system SHALL loại trừ mọi biên bản có `status = deleted` khỏi kết quả, không phân biệt actor.
- **FR-003**: THE system SHALL giới hạn `limit` tối đa 20 bản ghi/trang (tái dùng BR2 của UC-MKM-02).

### 3.2 Event-driven Requirements
- **FR-004**: WHEN client gửi `GET /api/v1/meeting-minutes/search-by-person?userId=<uuid>`, THE system SHALL kiểm tra tuần tự: (1) `userId` tồn tại và chưa xóa mềm trong `users`, (2) actor có role hợp lệ (`MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN`), trước khi truy vấn.
- **FR-005**: WHEN actor là `MANAGER`, THE system SHALL tính tập `managedDepartmentIds = SELECT id FROM departments WHERE manager_user_id = :managerId AND deleted_at IS NULL AND is_active = true` trước khi build điều kiện scope.
- **FR-006**: WHEN trả response, THE system SHALL bao gồm `meta.person` (id, fullName, email) của nhân sự đang được tra cứu, để FE hiển thị ngay context tìm kiếm mà không cần gọi thêm API.

### 3.3 State-driven Requirements
- **FR-007**: WHILE actor là `MANAGER`, THE system SHALL chỉ trả biên bản có `status IN (published, archived)` AND (`meeting.hostId`'s `departmentId` IN `managedDepartmentIds` OR (`meeting.hostId IS NULL` AND `meeting.organizerId`'s `departmentId` IN `managedDepartmentIds`)).
- **FR-008**: WHILE actor là `BUSINESS_ADMIN` hoặc `SYSTEM_ADMIN`, THE system SHALL trả biên bản có `status IN (draft, published, archived)` liên quan tới nhân sự, không áp dụng điều kiện phòng ban.
- **FR-009**: WHILE `managedDepartmentIds` rỗng (Manager không phụ trách phòng ban nào), THE system SHALL trả `200` với `data=[]` (không lỗi).

### 3.4 Optional Feature Requirements
- **FR-010**: WHERE client không truyền `page`/`limit`, THE system SHALL dùng mặc định `page=1`, `limit=20`.

### 3.5 Unwanted Behavior Requirements
- **FR-011**: IF `userId` không tồn tại hoặc đã xóa mềm trong `users`, THEN THE system SHALL trả `404 USER_NOT_FOUND`.
- **FR-012**: IF `userId` không phải UUID hợp lệ, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-013**: IF actor không có permission `meeting.minutes.search_by_person`, THEN THE system SHALL trả `403 FORBIDDEN`.
- **FR-014**: IF `limit > 20`, THEN THE system SHALL trả `400 VALIDATION_ERROR`.

### 3.6 Workflow Requirements
- **FR-015**: THE system SHALL thực hiện toàn bộ việc đọc dữ liệu (validate user + tính scope + query minutes) trong các câu SELECT độc lập, KHÔNG dùng transaction ghi (read-only use case).

### 3.7 Data & State Requirements
- **FR-016**: THE system SHALL không thêm cột/bảng mới (toàn bộ dữ liệu đã có trong baseline DB v3.2 Compact).
- **FR-017**: THE system SHALL không trả `minutesContent`, `decisionsJson`, `actionItemsJson`, `attendeesSnapshotJson` trong response danh sách (nhất quán FR-034 của `feat-list-meeting-minutes` — chỉ trả ở API xem chi tiết).

### 3.8 Notification / Audit Requirements
- **FR-018**: THE system SHALL NOT ghi `audit_logs` cho hành động tra cứu này (đọc dữ liệu, nhất quán FR-035 của `feat-list-meeting-minutes`).
- **FR-019**: THE system SHALL NOT gửi notification khi có người tra cứu.

### 3.9 Complex / Combined Requirements
- **FR-020**: IF `userId` hợp lệ AND actor có permission AND (actor là Admin HOẶC `managedDepartmentIds` chứa ít nhất 1 phòng ban liên quan tới cuộc họp của nhân sự đó), THEN THE system SHALL trả về danh sách biên bản đúng scope, kèm `meta.person` và `meta` phân trang, trong 1 lần gọi.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001 | Gợi ý UC-135 (API_CONTRACT) + Q&A "nhân sự liên quan" (mục 1.5) |
| FR-002, FR-003 | Kế thừa BR2/quy tắc loại trừ deleted từ UC-MKM-02 |
| FR-005, FR-007, FR-009 | BR1 của UC-MKM-07 gốc + Q&A "model phân quyền" (mục 1.5) |
| FR-008 | BR1 của UC-MKM-07 gốc (nhánh Business Admin) |
| FR-011 | EX1 của UC-MKM-07 gốc |
| Postcondition (data rỗng không lỗi) | EX2 của UC-MKM-07 gốc |
| FR-013 | Q&A "permission riêng" (mục 1.5) |

## 4. Non-functional Requirements

### 4.1 Performance
- API phản hồi < 500ms trong điều kiện bình thường (1 lần đọc `users`, 1 lần đọc `departments` nếu là Manager, 1 query chính có JOIN).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) + permission `meeting.minutes.search_by_person`.
- Scope theo phòng ban enforce ở tầng service, không tin tưởng bất kỳ tham số phân quyền nào từ client.
- Không trả `minutesContent`/nội dung nhạy cảm trong response danh sách (FR-017).

### 4.3 Reliability & Consistency
- Idempotent tự nhiên (GET thuần túy).
- Kết quả rỗng khi ngoài phạm vi không được coi là lỗi hệ thống (FR-009).

### 4.4 Usability
- Response trả kèm `meta.person` để FE không cần gọi thêm API xác nhận đang tra cứu ai.

### 4.5 Observability
- Log ở mức debug: `userId` (nhân sự được tra cứu), `actorId`, `actorRole`, số lượng kết quả — KHÔNG ghi `audit_logs` chính thức (xem FR-018).

### 4.6 Maintainability
- Đặt logic trong `MinutesService` (method `searchMinutesByPerson`), tách biệt khỏi `findMinutesList` — không tái sử dụng chung 1 method để tránh trộn lẫn 2 mô hình phân quyền khác nhau (xem `research.md` mục 3).

## 5. Data Model

### 5.1 Entity liên quan (chỉ đọc)
- `UserEntity` (bảng `users`) — validate `userId` tồn tại; đọc `departmentId` của `host`/`organizer` qua join gián tiếp.
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — bảng chính.
- `MeetingEntity` (bảng `meetings`) — JOIN lấy `hostId`, `organizerId`, thông tin summary.
- `MeetingParticipantEntity` (bảng `meeting_participants`) — điều kiện "nhân sự là participant".
- `DepartmentEntity` (bảng `departments`) — tính `managedDepartmentIds` khi actor là Manager.
- `RoomEntity` (bảng `rooms`) — room summary (tái dùng `RoomSummaryDto`).

### 5.2 Dữ liệu đầu vào (Query Parameters)
| Parameter | Type | Bắt buộc | Mô tả | Validation |
| :--- | ---: | ---: | :--- | :--- |
| `userId` | uuid | Có | Nhân sự cần tra cứu | UUID valid, tồn tại trong `users` (FR-011) |
| `page` | integer | Không (mặc định 1) | Số trang | >= 1 |
| `limit` | integer | Không (mặc định 20) | Số lượng/trang | 1 <= limit <= 20 |

### 5.3 Dữ liệu đầu ra (Response 200)
```jsonc
{
  "success": true,
  "message": "Danh sach bien ban lien quan den nhan su",
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "status": "published | archived | draft",
      "versionNo": 1,
      "createdAt": "ISO datetime",
      "meeting": {
        "id": "uuid", "title": "string",
        "actualStartTime": "ISO datetime | null",
        "actualEndTime": "ISO datetime | null",
        "meetingMode": "offline | online | hybrid",
        "room": { "id": "uuid", "roomName": "string" } | null
      },
      "host": { "id": "uuid", "fullName": "string", "email": "string" } | null
    }
  ],
  "meta": {
    "page": 1, "limit": 20, "total": 0, "totalPages": 0,
    "person": { "id": "uuid", "fullName": "string", "email": "string" }
  }
}
```
Cấu trúc từng item trong `data` tái dùng nguyên `MinutesListItemDto`/`MinutesMeetingSummaryDto` đã có ở `feat-list-meeting-minutes`, chỉ khác cơ chế scope phía sau.

### 5.4 State / Status Model
Chỉ đọc `status` (`draft/published/archived`, loại trừ `deleted`), không có transition trong feature này.

### 5.5 Data Constraints
- Manager: `status IN (published, archived)` bắt buộc AND điều kiện phòng ban.
- Admin: `status IN (draft, published, archived)`, không điều kiện phòng ban.
- Cả 2 nhánh: `deletedAt IS NULL`.

### 5.6 Data Lifecycle
Chỉ đọc — không thay đổi `meeting_minutes`, `meetings`, `departments`, hay bảng nào khác.

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-005, FR-007, FR-008, FR-016, FR-017.

## 6. Error Handling

### 6.1 Validation Errors
- `userId` không phải UUID hợp lệ → `400 VALIDATION_ERROR`.
- `limit > 20` hoặc `page < 1` → `400 VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission `meeting.minutes.search_by_person` → `403 FORBIDDEN`.

### 6.3 Business Rule Errors
- `userId` không tồn tại/đã xóa mềm → `404 USER_NOT_FOUND`.

### 6.4 Conflict Errors
Không áp dụng (read-only).

### 6.5 Integration / External Service Errors
Không có.

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
- **AC-001**: GIVEN Manager `M` là `manager_user_id` của phòng ban `D`, nhân sự `U` có 1 biên bản `published` mà `meeting.host` thuộc phòng ban `D`, WHEN `M` gọi API với `userId=U`, THEN trả `200`, `data` chứa biên bản đó.
- **AC-002**: GIVEN `U` có 1 biên bản `published` mà `meeting.host` thuộc phòng ban KHÁC `D`, WHEN `M` gọi API với `userId=U`, THEN `data` KHÔNG chứa biên bản đó.
- **AC-003**: GIVEN Business Admin gọi API với `userId=U` bất kỳ, WHEN `U` có cả biên bản `draft` lẫn `published`, THEN `data` chứa CẢ HAI (Admin không bị giới hạn phòng ban/status).
- **AC-004**: GIVEN `U` là `preparedBy` của 1 biên bản `published` (không phải participant), WHEN Manager của phòng ban đó gọi API, THEN biên bản đó vẫn xuất hiện trong `data`.
- **AC-005**: GIVEN response thành công, THEN `meta.person` chứa đúng `id/fullName/email` của `U`.

### 7.2 Authorization Cases
- **AC-006**: GIVEN Manager không phụ trách phòng ban nào (`departments.manager_user_id` không trỏ tới họ), WHEN gọi API, THEN trả `200` với `data=[]`.
- **AC-007**: GIVEN người gọi có role `INTERNAL_USER` (không phải Manager/Admin), WHEN gọi API, THEN trả `403 FORBIDDEN` (không có permission).
- **AC-008**: GIVEN System Admin gọi API, WHEN `U` có biên bản bất kỳ status nào, THEN hành vi giống hệt Business Admin.

### 7.3 Business Rule Cases
- **AC-009**: GIVEN Manager gọi API cho `userId=U`, WHEN `U` có 1 biên bản `draft` (do `U` tự soạn), THEN biên bản `draft` đó KHÔNG xuất hiện trong `data` (kể cả khi cuộc họp thuộc đúng phòng ban Manager quản lý).

### 7.4 Validation Cases
- **AC-010**: GIVEN `userId` không phải UUID hợp lệ, WHEN gọi API, THEN trả `400 VALIDATION_ERROR`.
- **AC-011**: GIVEN `limit=50`, WHEN gọi API, THEN trả `400 VALIDATION_ERROR`.

### 7.5 State Transition Cases
- **AC-012**: GIVEN `userId` không tồn tại (UUID hợp lệ nhưng không có user), WHEN gọi API, THEN trả `404 USER_NOT_FOUND`.
- **AC-013**: GIVEN `userId` đã bị xóa mềm, WHEN gọi API, THEN trả `404 USER_NOT_FOUND`.

### 7.6 Notification / Audit Cases
- **AC-014**: GIVEN gọi API thành công, THEN KHÔNG có bản ghi `audit_logs` mới nào được tạo.

### 7.7 Empty Result Cases
- **AC-015**: GIVEN `U` tồn tại nhưng chưa từng liên quan tới bất kỳ biên bản nào trong phạm vi actor, WHEN gọi API, THEN trả `200` với `data=[]`, `meta.total=0` (đúng EX2 của UC gốc — không phải lỗi).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-004 | FR-001, FR-007 |
| AC-002 | FR-007 |
| AC-003, AC-008 | FR-008 |
| AC-005 | FR-006 |
| AC-006, AC-015 | FR-009 |
| AC-007 | Permission guard (mục 2.2) |
| AC-009 | FR-007 (draft loại trừ với Manager) |
| AC-010, AC-011 | FR-012, FR-014 |
| AC-012, AC-013 | FR-011 |
| AC-014 | FR-018 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Autocomplete tìm nhân sự (bước 3-4 Normal Flow) — tái sử dụng `GET /api/v1/users` đã có.
- Filter bổ sung theo `status`/`from`/`to`/`q`/`sortBy` trên endpoint mới (chỉ sort mặc định `actual_start_time DESC`).
- Đệ quy phòng ban con (`parent_department_id`).
- Model phân quyền theo `direct_manager_id` (đã quyết định dùng `departments.manager_user_id`, xem mục 1.4).
- Xem chi tiết 1 biên bản từ kết quả tìm kiếm (dùng API xem chi tiết riêng, `feat-view-meeting-minutes-detail`, khi đã implement).
- Export kết quả tìm kiếm ra file.

### 8.2 Có thể xem xét ở feature khác
- Bổ sung filter `status`/`date range` cho endpoint search-by-person nếu người dùng có nhu cầu thực tế.
- Hỗ trợ đệ quy phòng ban con nếu cơ cấu tổ chức yêu cầu.
- Thống nhất 2 model "quản lý" (`direct_manager_id` vs `departments.manager_user_id`) thành 1 khái niệm chung trong tương lai — hiện tại 2 model tồn tại song song cho 2 mục đích khác nhau (attendance vs minutes search), cần Product Owner xác nhận nếu muốn hợp nhất.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT trả `minutesContent`/`decisionsJson`/`actionItemsJson`/`attendeesSnapshotJson` trong response của feature này.
- **FR-OOS-002**: THE system SHALL NOT cấp permission `meeting.minutes.search_by_person` cho role `INTERNAL_USER`.
- **FR-OOS-003**: THE system SHALL NOT áp dụng đệ quy phòng ban con khi tính `managedDepartmentIds`.
- **FR-OOS-004**: THE system SHALL NOT trả biên bản `draft` cho actor Manager, dù cuộc họp thuộc đúng phòng ban quản lý.

## Assumptions
Xem mục 1.4 và 1.5.
