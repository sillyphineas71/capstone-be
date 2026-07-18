# Feature Specification: Chia sẻ biên bản họp cho người dùng cụ thể (Share Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo spec, phát sinh từ yêu cầu trực tiếp của Product Owner qua trao đổi hội thoại (không có UC gốc trong Feature Table) | Toàn bộ file |

> Nguồn gốc: **Không có UC gốc trong Feature Table.** Product Owner nêu trực tiếp: hiện tại chỉ Host/participant của meeting (và Admin) mới xem được biên bản đã ban hành; muốn bổ sung khả năng Host **tự chọn thêm** những người cụ thể ngoài danh sách participant được xem biên bản. Tạm đặt tên **UC-MKM-0y (mới)**, chờ Product Owner gán số chính thức trong Feature Table — theo đúng tiền lệ đã áp dụng ở `feat-attach-minutes-document`.

## 1. Context & Goal

### 1.1 Bối cảnh
Quy tắc xem biên bản hiện tại (hàm `canAccessMinutes()`, `minutes.service.ts:910-929`, đã xác nhận bằng cách đọc code thật, không phải chỉ đọc spec):
```text
isAdmin (SYSTEM_ADMIN / BUSINESS_ADMIN)  → luôn xem được
status = draft                          → chỉ preparedBy (người soạn)
status = published / archived           → Host (meeting.hostId) HOẶC bất kỳ participant nào của meeting
```
`MANAGER` **không** tự động bypass (khác giả định ban đầu của Product Owner) — Manager hiện chỉ có quyền riêng "tìm biên bản theo người" (`feat-search-minutes-by-person`, UC-MKM-07), không phải quyền xem toàn văn tự động cho mọi biên bản.

Đây là hàm **1 choke-point duy nhất**, dùng chung cho cả xem chi tiết biên bản (`findMinutesDetail`) lẫn xem/tải file đính kèm (`loadMinutesForReadCheck` gọi lại đúng hàm này, có comment xác nhận "Dung chung logic voi findMinutesDetail (canAccessMinutes)"). Đặc điểm này thuận lợi cho feature này: chỉ cần mở rộng 1 hàm, tự động áp dụng cho cả 2 luồng đọc.

Product Owner muốn: Host (hoặc `preparedBy`) được **chủ động chọn thêm cá nhân cụ thể** (ngoài participant của meeting) để cấp quyền xem biên bản — dạng "share" giống chia sẻ tài liệu (Google Docs), không phải mở rộng nhóm rộng (participant/department) như `visibility_level` hiện có.

### 1.2 Mục tiêu
Cung cấp 3 endpoint cho phép Host/`preparedBy` (hoặc Business Admin/System Admin) của 1 biên bản **đã ban hành (`published`)**: (a) cấp quyền xem cho 1 user nội bộ bất kỳ trong hệ thống, (b) xem danh sách đang được cấp quyền, (c) thu hồi quyền đã cấp. Người được cấp quyền chỉ có quyền **xem** (biên bản + file đính kèm) — không được export/sửa/xóa.

### 1.3 Giá trị mang lại
- Host chủ động chia sẻ biên bản cho người ngoài phạm vi cuộc họp (ví dụ: quản lý cấp trên không dự họp nhưng cần nắm nội dung, đồng nghiệp phòng ban khác cần tham khảo) mà không phải thêm họ vào `meeting_participants` (vốn có ý nghĩa khác — tham dự cuộc họp, không phải "được xem biên bản").
- Tách biệt rõ 2 khái niệm vốn đang bị gộp chung: "là participant của cuộc họp" và "được phép xem biên bản của cuộc họp đó" — participant vẫn tự động xem được (giữ nguyên hành vi cũ), share chỉ **cộng thêm**, không thay thế.
- Tái sử dụng tối đa hạ tầng sẵn có (`AuthzReadRepository`, `UserEntity`, `AuditLogsService`, pattern ownership-or-admin đã dùng ở `issue`/`update`/`delete`).

### 1.4 Giả định
- Biên bản (`meeting_minutes`) đã tồn tại, đang ở `status = published` khi thực hiện thao tác grant (Product Owner xác nhận: **không** share được lúc còn `draft`).
- Sau khi đã share thành công, quyền xem đó **vẫn còn hiệu lực** nếu biên bản sau này chuyển sang `archived` (không tự động thu hồi) — nhất quán với việc `archived` vốn đã mở quyền xem rộng hơn `draft` trong `canAccessMinutes()` hiện tại. Chỉ riêng **hành động grant/revoke mới** (tạo/xóa 1 dòng share) mới bị giới hạn phải `status = published` tại thời điểm gọi.
- Share cho **bất kỳ user nội bộ (`users`) nào đang active** trong hệ thống (Product Owner xác nhận: không giới hạn theo phòng ban/participant).
- Không share được cho external participant (`meeting_external_participants`) — nhóm này không có tài khoản/JWT, không gọi API authenticated (nhất quán nguyên tắc đã áp dụng xuyên suốt dự án cho external participant).
- Quyền được share chỉ dừng ở mức **đọc** (xem chi tiết biên bản + danh sách/tải file đính kèm) — không mở rộng cho export (`feat-export-meeting-minutes`, UC-147, vẫn strictly Host/Preparer/Admin only) hay bất kỳ thao tác ghi nào khác.
- Không thêm notification tự động khi share/unship trong phạm vi feature này (xem mục 8 — có thể làm sau nếu cần).

### 1.5 Cần làm rõ — đã giải quyết qua phân tích + Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] Thời điểm được phép share?** Chỉ khi `status = published` (Q&A, Product Owner chọn "Chỉ sau khi đã ban hành").
- **[ĐÃ GIẢI QUYẾT] Share cho ai?** Bất kỳ user nội bộ active nào trong hệ thống, không giới hạn phòng ban (Q&A, Product Owner chọn "Bất kỳ user nội bộ nào").
- **[ĐÃ GIẢI QUYẾT] Dùng `visibility_level` có sẵn hay bảng mới?** Bảng mới `meeting_minutes_shares` — `visibility_level` (enum `PRIVATE/PARTICIPANTS/DEPARTMENT/PUBLIC_INTERNAL`) chỉ biểu diễn nhóm rộng, không biểu diễn "share đích danh cho N người cụ thể"; hơn nữa field này hiện **không được bất kỳ logic phân quyền nào đọc tới** (đã xác nhận ở nhiều spec trước) nên không có rủi ro conflict khi thêm cơ chế song song.
- **[ĐÃ GIẢI QUYẾT] Ai được quản lý danh sách share?** Chỉ Host/`preparedBy` + Admin — đúng OR-rule ownership đã dùng nhất quán ở `issue`/`update`/`delete`.
- **[ĐÃ GIẢI QUYẾT] Quyền của người được share?** Chỉ xem (đọc) — không export/sửa/xóa.
- **[ĐÃ GIẢI QUYẾT] Share trùng lặp (share lại người đã được share) xử lý sao?** Trả lỗi `409 ALREADY_SHARED` thay vì no-op 200 — nhất quán triết lý "không âm thầm no-op mutation" đã áp dụng cho `AGENDA_DUPLICATE_ITEM_ID` ở module `meetings` cùng dự án.
- **[ĐÃ GIẢI QUYẾT] Revoke cho người chưa từng được share xử lý sao?** Trả lỗi `404 SHARE_NOT_FOUND` — không giả vờ thành công, nhất quán idempotency-nhưng-không-fake-success đã áp dụng cho DELETE agenda item (UC-MM-11) cùng dự án.
- **[ĐÃ GIẢI QUYẾT] Share cho chính participant/host/preparedBy (vốn đã có quyền sẵn) có bị chặn không?** KHÔNG chặn — cho phép, coi là vô hại (dòng dữ liệu thừa nhưng không gây lỗi/xung đột logic, tránh thêm validation không cần thiết).
- **[ĐÃ GIẢI QUYẾT] Xóa dữ liệu share dùng hard-delete hay soft-delete?** Hard-delete — theo đúng tiền lệ đã có sẵn trong chính baseline DB cho bảng `role_permissions` (revoke quyền = `DELETE` thẳng, không có `deleted_at`) và `meeting_participants` (UC-MM-08, remove participant cũng hard-delete). `meeting_minutes_shares` là 1 bảng ACL/grant thuần túy (không phải business record cần audit trail vĩnh viễn qua soft-delete) — bản ghi `audit_logs` đã đủ để truy vết lịch sử share/unshare nếu cần. Ghi nhận đây là áp dụng lại đúng pattern đã tồn tại, không phải phát sinh deviation mới (xem `research.md` mục 4 cho đối chiếu Constitution `DATA-01`).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor (Grant/Revoke/List quản lý)**: Internal Employee giữ vai trò Host — `meeting_minutes.preparedBy` HOẶC `meeting.hostId` hiện tại.
- **Primary Actor (Grant/Revoke/List quản lý)**: Business Admin, System Admin (bypass hoàn toàn ownership check, KHÔNG bypass điều kiện `status = published`).
- **Secondary Actor (hưởng lợi, không tự thao tác API này)**: User được share — chỉ tự động có quyền đọc qua `canAccessMinutes()` mở rộng, không gọi API grant/revoke/list quản lý.

### 2.2 Role & Permission Rules
- 3 permission code mới: `meeting.minutes.share.create`, `meeting.minutes.share.read`, `meeting.minutes.share.delete` (module_code=`minutes`) — đúng convention granularity đã dùng cho `meeting.minutes.attachment.{create,read,delete}`.
- Role mặc định được cấp cả 3: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` — sở hữu permission là điều kiện cần nhưng chưa đủ, service còn kiểm tra ownership.
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass ownership; `INTERNAL_USER`/`MANAGER` phải thỏa ownership rule (mục 2.3).
- Người được share **không cần** permission `meeting.minutes.share.*` nào — họ chỉ hưởng lợi qua nhánh mở rộng của `meeting.minutes.read` (permission đọc biên bản đã có sẵn từ `feat-list-meeting-minutes`).

### 2.3 Actor Constraints
- `INTERNAL_USER`/`MANAGER` chỉ grant/revoke/list quản lý được khi thỏa `userId === preparedBy OR userId === meeting.hostId`. Participant/Organizer thường (không thỏa) **không** được quản lý share.
- Biên bản phải ở `status = published` tại thời điểm grant hoặc revoke — nếu `draft`/`archived`/`deleted`, **mọi** actor đều bị từ chối, kể cả Admin (xem mục 1.4 cho phân biệt: đọc share hiện có không bị chặn bởi `archived`, chỉ hành động grant/revoke mới bị chặn).
- `targetUserId` phải là user nội bộ đang `accountStatus = active` (không active/đã xóa mềm → từ chối).

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép Host/`preparedBy`/Admin cấp quyền xem 1 biên bản `published` cho 1 user nội bộ active bất kỳ, không giới hạn theo `meeting_participants` hay phòng ban.
- **FR-002**: THE system SHALL lưu mỗi lượt cấp quyền thành 1 dòng trong bảng mới `meeting_minutes_shares` (`minutes_id`, `user_id`, `granted_by`, `granted_at`).
- **FR-003**: THE system SHALL cho phép Host/`preparedBy`/Admin thu hồi (hard-delete) 1 lượt cấp quyền đã tồn tại.
- **FR-004**: THE system SHALL cho phép Host/`preparedBy`/Admin xem danh sách đầy đủ những user đang được share (kèm tên hiển thị, người cấp, thời điểm cấp).

### 3.2 Event-driven Requirements
- **FR-005**: WHEN người dùng gửi `POST /meeting-minutes/:id/shares` với `{userId}`, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại + chưa xóa mềm, (2) người gọi thỏa ownership-or-admin, (3) `minutes.status = published`, (4) `targetUserId` tồn tại + `accountStatus = active`, (5) chưa tồn tại share trùng (`minutes_id`, `user_id`), trước khi insert.
- **FR-006**: WHEN grant thành công, THE system SHALL ghi 1 bản ghi `audit_logs` (`action_type = meeting_minutes_shared`).
- **FR-007**: WHEN người dùng gửi `DELETE /meeting-minutes/:id/shares/:userId`, THE system SHALL kiểm tra tuần tự: (1) biên bản tồn tại + chưa xóa mềm, (2) người gọi thỏa ownership-or-admin, (3) `minutes.status = published`, (4) tồn tại share hiện có cho `(minutesId, userId)`, trước khi xóa.
- **FR-008**: WHEN revoke thành công, THE system SHALL ghi 1 bản ghi `audit_logs` (`action_type = meeting_minutes_unshared`).
- **FR-009**: WHEN `canAccessMinutes()` được gọi cho biên bản `published` HOẶC `archived`, THE system SHALL trả `true` nếu tồn tại 1 dòng `meeting_minutes_shares` khớp `(minutesId, userId)`, cộng thêm vào các nhánh `isAdmin`/`isHost`/`isParticipant` hiện có (OR logic, không thay thế).

### 3.3 State-driven Requirements
- **FR-010**: WHILE `meeting_minutes.status != published`, THE system SHALL từ chối mọi request grant/revoke (kể cả từ Admin), trả `409 MINUTES_NOT_PUBLISHED`.
- **FR-011**: WHILE biên bản đã chuyển sang `archived` SAU KHI đã có share hợp lệ từ trước, THE system SHALL vẫn cho phép user đã được share tiếp tục xem (không tự động thu hồi khi status đổi).

### 3.4 Optional Feature Requirements
- **FR-012**: WHERE feature notification cần thông báo cho user khi được share biên bản, feature đó có thể đọc `audit_logs action = meeting_minutes_shared` (deferred, không implement trong feature này).

### 3.5 Unwanted Behavior Requirements
- **FR-013**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MINUTES_NOT_FOUND`.
- **FR-014**: IF người gọi là `INTERNAL_USER`/`MANAGER` và không thỏa ownership rule, THEN THE system SHALL trả `403 NOT_MINUTES_OWNER`.
- **FR-015**: IF người gọi không có permission tương ứng (`meeting.minutes.share.create/read/delete`), THEN THE system SHALL trả `403 FORBIDDEN`.
- **FR-016**: IF `targetUserId` không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 USER_NOT_FOUND`.
- **FR-017**: IF `targetUserId` tồn tại nhưng `accountStatus != active`, THEN THE system SHALL trả `422 USER_INACTIVE`.
- **FR-018**: IF grant cho `(minutesId, userId)` đã tồn tại từ trước, THEN THE system SHALL trả `409 ALREADY_SHARED`, không tạo dòng trùng.
- **FR-019**: IF revoke cho `(minutesId, userId)` không tồn tại, THEN THE system SHALL trả `404 SHARE_NOT_FOUND`.
- **FR-020**: IF `targetUserId`/`minutesId`/`userId` (path param) không phải UUID hợp lệ, THEN THE system SHALL trả `400`.

### 3.6 Workflow Requirements
- **FR-021**: THE system SHALL thực hiện toàn bộ chuỗi validate (FR-005/FR-007) trong 1 transaction đơn giản (không cần pessimistic lock — race condition tối đa dẫn tới lỗi `UNIQUE constraint` ở DB, service catch và map sang `409 ALREADY_SHARED`).

### 3.7 Data & State Requirements
- **FR-022**: THE system SHALL thêm 1 bảng mới `meeting_minutes_shares` (justified — yêu cầu rõ ràng từ Product Owner, xem mục 1.5). KHÔNG thêm cột mới vào `meeting_minutes`/`users`.
- **FR-023**: THE system SHALL thêm 3 permission mới qua migration (`meeting.minutes.share.create/read/delete`).
- **FR-024**: THE system SHALL đặt `UNIQUE (minutes_id, user_id)` trên bảng mới để DB tự chặn duplicate ở tầng constraint (phòng hờ race condition), không chỉ dựa vào check ở tầng service.

### 3.8 Notification / Audit Requirements
- Xem FR-006, FR-008 cho audit. Không có notification tự động (xem FR-012, mục 8).

### 3.9 Complex / Combined Requirements
- **FR-025**: IF `minutes.status = published` AND (người gọi thỏa ownership rule HOẶC là Admin) AND `targetUserId` là user active hợp lệ AND chưa tồn tại share trùng, THEN THE system SHALL: insert 1 dòng `meeting_minutes_shares`, ghi audit log, trả `201` với dữ liệu share vừa tạo — tất cả trong 1 lần gọi.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001..004 | Yêu cầu trực tiếp Product Owner |
| FR-005, FR-007, FR-025 | Pattern validate-trước-ghi đã dùng ở `issue`/`export` |
| FR-009, FR-011 | Q&A "share cho phép sau published, không tự thu hồi khi archived" (mục 1.5) |
| FR-018 | Q&A "duplicate share → lỗi, không no-op" (mục 1.5) |
| FR-019 | Q&A "revoke không tồn tại → 404, không fake success" (mục 1.5) |
| FR-022, FR-024 | Q&A "bảng mới, không dùng visibility_level" (mục 1.5) |

## 4. Non-functional Requirements

### 4.1 Performance
- Cả 3 API (grant/revoke/list) phải phản hồi < 500ms (thao tác đơn giản: 1-2 SELECT + 1 INSERT/DELETE, không có I/O nặng/async job).

### 4.2 Security
- Mọi endpoint yêu cầu JWT hợp lệ + permission tương ứng.
- Ownership/Admin-bypass check enforce ở tầng service, không tin tham số phân quyền từ client.
- Danh sách share (`GET .../shares`) chỉ Host/`preparedBy`/Admin xem được (không public cho participant thường hay chính người được share) — tránh lộ thông tin "ai đang được share ngầm" cho người không liên quan.

### 4.3 Reliability & Consistency
- `UNIQUE (minutes_id, user_id)` ở tầng DB đảm bảo không có duplicate ngay cả khi 2 request grant cùng lúc race nhau — service catch lỗi constraint violation, map sang `409 ALREADY_SHARED` thay vì để lộ lỗi DB thô ra client (ENG-03).
- Revoke idempotent-nhưng-không-fake-success: gọi lại lần 2 cho cùng cặp `(minutesId, userId)` trả `404`, không `200` giả (xem mục 1.5).

### 4.4 Usability
- Response của `GET .../shares` trả kèm `userFullName`/`userEmail` (không chỉ `userId` thô) để FE hiển thị trực tiếp, không cần gọi thêm API user detail cho từng dòng.

### 4.5 Observability
- Log đủ `minutesId`, `targetUserId`, `actorUserId`, kết quả (success/lỗi + code) cho cả grant/revoke.

### 4.6 Maintainability
- Business logic đặt trong `MinutesService` (3 method mới: `shareMinutes`, `unshareMinutes`, `listMinutesShares`), tái sử dụng ownership-check helper đã có từ `issueMinutes`.
- Sửa `canAccessMinutes()` là điểm chạm DUY NHẤT cần mở rộng cho phần đọc — không cần sửa `findMinutesDetail`/`loadMinutesForReadCheck` (2 nơi đang gọi hàm này) vì logic nằm gọn trong hàm dùng chung.

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesShareEntity` (bảng mới `meeting_minutes_shares`) — ghi (grant/revoke) + đọc (list, và đọc trong `canAccessMinutes`).
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc (`status`, `preparedBy`), không ghi.
- `MeetingEntity` (bảng `meetings`) — đọc `hostId` (ownership check), không ghi.
- `UserEntity` (bảng `users`) — đọc (`accountStatus`, `fullName`, `email` của target user + actor), không ghi.
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng/lần grant hoặc revoke thành công.

### 5.2 Dữ liệu đầu vào

**Grant** — `POST /api/v1/meeting-minutes/:id/shares`:
```jsonc
{ "userId": "uuid" }  // bắt buộc
```

**Revoke** — `DELETE /api/v1/meeting-minutes/:id/shares/:userId` — không có body, `userId` là path param.

**List** — `GET /api/v1/meeting-minutes/:id/shares` — không có input ngoài path param `:id`.

### 5.3 Dữ liệu đầu ra

**Grant (201):**
```jsonc
{
  "success": true,
  "message": "Da chia se bien ban thanh cong",
  "data": {
    "id": "uuid",
    "minutesId": "uuid",
    "userId": "uuid",
    "userFullName": "string",
    "grantedBy": "uuid",
    "grantedAt": "ISO datetime"
  }
}
```

**List (200):**
```jsonc
{
  "success": true,
  "message": "Lay danh sach chia se thanh cong",
  "data": {
    "minutesId": "uuid",
    "shares": [
      {
        "id": "uuid",
        "userId": "uuid",
        "userFullName": "string",
        "userEmail": "string",
        "grantedBy": "uuid",
        "grantedByName": "string",
        "grantedAt": "ISO datetime"
      }
    ]
  }
}
```

**Revoke (200):**
```jsonc
{
  "success": true,
  "message": "Da thu hoi quyen xem bien ban",
  "data": { "minutesId": "uuid", "userId": "uuid", "revoked": true }
}
```

### 5.4 State / Status Model
Không có state machine riêng cho `meeting_minutes_shares` — 1 dòng tồn tại = đang được share; xóa dòng = thu hồi. `meeting_minutes.status` KHÔNG bị feature này thay đổi.

### 5.5 Data Constraints
- `UNIQUE (minutes_id, user_id)`.
- Grant/revoke chỉ khi `meeting_minutes.status = published` tại thời điểm gọi.
- `user_id` phải tồn tại trong `users` và `account_status = active`.

### 5.6 Data Lifecycle
Ban hành (`feat-issue-meeting-minutes`, `status=published`) → **Host share cho N người cụ thể (feature này, lặp lại nhiều lần, độc lập với export/distribute)** → (không tự động thu hồi khi biên bản chuyển `archived`) → Host có thể revoke bất cứ lúc nào (miễn `status` vẫn `published` tại thời điểm revoke).

### 5.7 Data-related EARS Requirements
Xem FR-002, FR-022, FR-024.

## 6. Error Handling

### 6.1 Validation Errors
- `id` (path, minutesId) hoặc `userId` (path/body) không phải UUID hợp lệ → `400`.
- Body grant thiếu `userId` → `400 VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission tương ứng → `403 FORBIDDEN`.
- Có permission nhưng không thỏa ownership rule (và không phải Admin) → `403 NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → `404 MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `published` (grant/revoke) → `409 MINUTES_NOT_PUBLISHED`.
- `targetUserId` không tồn tại/đã xóa mềm → `404 USER_NOT_FOUND`.
- `targetUserId` không active → `422 USER_INACTIVE`.
- Grant trùng lặp → `409 ALREADY_SHARED`.
- Revoke share không tồn tại → `404 SHARE_NOT_FOUND`.

### 6.4 Conflict Errors
Xem 6.3 (`MINUTES_NOT_PUBLISHED`, `ALREADY_SHARED`).

### 6.5 Integration / External Service Errors
Không có (không gọi service ngoài).

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
- **AC-001**: GIVEN biên bản `M` `status=published`, `preparedBy=U`, WHEN `U` gọi `POST .../shares` với `userId=X` (X là user active, chưa được share), THEN trả `201`, tạo 1 dòng `meeting_minutes_shares`, ghi audit log.
- **AC-002**: GIVEN sau AC-001, WHEN user `X` gọi `GET /meeting-minutes/M` (xem chi tiết), THEN trả `200` (được xem, dù `X` không phải participant/host của meeting).
- **AC-003**: GIVEN sau AC-001, WHEN `U` gọi `GET .../shares`, THEN trả danh sách chứa đúng 1 phần tử với `userId=X`.
- **AC-004**: GIVEN sau AC-001, WHEN `U` gọi `DELETE .../shares/X`, THEN trả `200`, dòng share bị xóa, audit log ghi nhận.
- **AC-005**: GIVEN sau AC-004, WHEN user `X` gọi lại `GET /meeting-minutes/M`, THEN trả `403 MEETING_MINUTES_ACCESS_DENIED` (đã bị thu hồi, không còn là participant/host).
- **AC-006**: GIVEN Business Admin `C` gọi grant/revoke cho biên bản bất kỳ (không phải preparedBy/host), THEN trả thành công (Admin bypass ownership).

### 7.2 Authorization Cases
- **AC-007**: GIVEN người gọi là Participant của meeting (không phải preparedBy/host/Admin), WHEN gọi grant/revoke/list, THEN trả `403 NOT_MINUTES_OWNER`.
- **AC-008**: GIVEN người gọi không có permission `meeting.minutes.share.create`, WHEN gọi grant, THEN trả `403 FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-009**: GIVEN biên bản `status=draft`, WHEN Host gọi grant, THEN trả `409 MINUTES_NOT_PUBLISHED`.
- **AC-010**: GIVEN biên bản `status=archived`, WHEN Host gọi grant (share mới), THEN trả `409 MINUTES_NOT_PUBLISHED` (chỉ hành động grant/revoke bị chặn, KHÔNG ảnh hưởng share đã tồn tại từ trước — xem AC-014).
- **AC-011**: GIVEN `targetUserId` không active (`accountStatus != active`), WHEN Host gọi grant, THEN trả `422 USER_INACTIVE`.
- **AC-012**: GIVEN `targetUserId` không tồn tại, WHEN Host gọi grant, THEN trả `404 USER_NOT_FOUND`.
- **AC-013**: GIVEN `targetUserId` đã được share từ trước, WHEN Host gọi grant lại cho cùng user, THEN trả `409 ALREADY_SHARED`, không tạo dòng trùng.
- **AC-014**: GIVEN biên bản đã share cho `X` lúc còn `published`, sau đó chuyển `archived`, WHEN `X` gọi `GET /meeting-minutes/M`, THEN vẫn trả `200` (share cũ không tự động mất hiệu lực).

### 7.4 Validation Cases
- **AC-015**: GIVEN `id` (minutesId) không phải UUID hợp lệ, WHEN gọi bất kỳ endpoint nào trong feature, THEN trả `400`.
- **AC-016**: GIVEN body grant thiếu `userId`, WHEN gọi grant, THEN trả `400 VALIDATION_ERROR`.

### 7.5 State / Not Found Cases
- **AC-017**: GIVEN biên bản không tồn tại (`id` ngẫu nhiên hợp lệ UUID), WHEN gọi grant/revoke/list, THEN trả `404 MINUTES_NOT_FOUND`.
- **AC-018**: GIVEN revoke cho `userId` chưa từng được share, WHEN Host gọi revoke, THEN trả `404 SHARE_NOT_FOUND` (không fake success).

### 7.6 Audit Cases
- **AC-019**: GIVEN grant thành công, THEN có đúng 1 `audit_logs` mới `action_type=meeting_minutes_shared`.
- **AC-020**: GIVEN revoke thành công, THEN có đúng 1 `audit_logs` mới `action_type=meeting_minutes_unshared`.

### 7.7 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-003, AC-004 | FR-001, FR-002, FR-003, FR-004, FR-025 |
| AC-002, AC-005, AC-014 | FR-009, FR-011 |
| AC-006 | FR-005, FR-007 (ownership-or-admin) |
| AC-007 | FR-014 |
| AC-008 | FR-015 |
| AC-009, AC-010 | FR-010 |
| AC-011 | FR-017 |
| AC-012 | FR-016 |
| AC-013 | FR-018 |
| AC-015, AC-016 | FR-020 |
| AC-017 | FR-013 |
| AC-018 | FR-019 |
| AC-019 | FR-006 |
| AC-020 | FR-008 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Notification tự động khi được share/unshare (xem FR-012 — deferred).
- Cho phép người được share export biên bản (vẫn strictly Host/Preparer/Admin theo UC-147).
- Share cho external participant (không có tài khoản hệ thống).
- Share cho cả nhóm/phòng ban 1 lượt (bulk share theo department) — chỉ share từng cá nhân, 1 request/1 user.
- Cho phép share khi biên bản còn `draft` hoặc đã `archived` (chỉ `published` tại thời điểm grant/revoke).
- Giới hạn số lượng người được share tối đa/biên bản (không có cap trong đợt này).
- Phân cấp quyền share chi tiết hơn (ví dụ "share chỉ đọc nội dung, không đọc file đính kèm") — hiện tại share = full read access (biên bản + đính kèm), không tách nhỏ hơn.

### 8.2 Có thể xem xét ở feature khác
- Gửi notification khi được share/unshare.
- Bulk share theo department/nhóm.
- UI hiển thị badge "đã được chia sẻ" trên danh sách biên bản của người được share.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cho phép grant/revoke khi `meeting_minutes.status != published`, kể cả với Business Admin/System Admin.
- **FR-OOS-002**: THE system SHALL NOT mở rộng quyền của user được share sang export/sửa/xóa biên bản.
- **FR-OOS-003**: THE system SHALL NOT gửi notification tự động khi grant/revoke trong phạm vi feature này.
- **FR-OOS-004**: THE system SHALL NOT cho phép share cho external participant (`meeting_external_participants`).

## Assumptions
Xem mục 1.4 và 1.5.
