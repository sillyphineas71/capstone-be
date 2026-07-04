# Feature Specification: Xóa biên bản họp nháp (Delete Draft Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-05 (khớp UC-133 trong API_CONTRACT_v1.0_with_system_roles.md), sau vòng thảo luận + Q&A trực tiếp với Product Owner | Toàn bộ file |

> Nguồn gốc: UC-MKM-05 "Xóa biên bản họp nháp" (Feature Table gốc, do người dùng cung cấp trực tiếp) + UC-133 "Xóa biên bản họp nháp" trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (dòng 4402-4419). Spec này chuẩn hóa UC gốc (vốn ghi `Exceptions: N/A`, `Other Information: N/A`, không định nghĩa cascade cho attachment/notification) theo baseline code hiện có (`MeetingMinutesEntity`, `feat-attach-minutes-document`, `feat-update-draft-meeting-minutes`) và các quyết định đã chốt qua Q&A (xem mục 1.5, `research.md`).

## 1. Context & Goal

### 1.1 Bối cảnh
Trong vòng đời biên bản họp (`draft → published/issued → archived`), người soạn thảo hoặc quản trị viên đôi khi cần hủy bỏ hoàn toàn một bản nháp không còn dùng (tạo nhầm cuộc họp, nội dung sai từ đầu, trùng lặp). Feature này bổ sung bước "xóa" còn thiếu trong vòng đời biên bản, chỉ áp dụng cho biên bản đang `draft` (đã ban hành thì không xóa được qua UC này).

### 1.2 Mục tiêu
Cung cấp 1 endpoint `DELETE` cho phép người có quyền (Host — theo nghĩa `prepared_by` HOẶC `meeting.hostId` — hoặc Business Admin/System Admin) soft-delete một `meeting_minutes` đang `draft`, đồng thời cascade soft-delete toàn bộ file đính kèm liên quan (ở tầng DB) để tránh rác dữ liệu, và ghi audit log đầy đủ.

### 1.3 Giá trị mang lại
- Hoàn thiện vòng đời CRUD cơ bản của biên bản nháp (tạo → sửa → **xóa**), tránh tồn đọng bản nháp rác trong danh sách.
- Cho phép Business Admin can thiệp dọn dẹp/quản trị khi cần (ví dụ Host nghỉ việc, tạo nhầm), không phải chờ đúng người tạo.
- Tránh rác dữ liệu `media_files` mồ côi khi biên bản cha đã bị xóa (cascade soft-delete).

### 1.4 Giả định
- Biên bản họp (`meeting_minutes`) đã tồn tại, đang ở `status = draft`.
- Xóa là **soft-delete** (BR1 của UC gốc) — không hard-delete bất kỳ bản ghi nào.
- Không xóa file vật lý trên storage trong phạm vi feature này — chỉ soft-delete bản ghi `media_files` liên quan (dọn storage vật lý, nếu cần, là việc của 1 job dọn rác riêng, ngoài phạm vi).
- Endpoint và route theo đúng convention `meeting-minutes` đã dùng ở các spec `minutes` trước (`DELETE /api/v1/meeting-minutes/:id`), không theo literal path `/api/v1/minutes/{minutesId}` của UC-133 trong API_CONTRACT — cùng lý do deviation đã ghi trong `feat-update-draft-meeting-minutes/spec.md` mục 1.4.

### 1.5 Cần làm rõ — đã giải quyết qua Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] "Host" nghĩa là gì?** Giống hệt quyết định ở `feat-update-draft-meeting-minutes`: `authUser.userId === meeting_minutes.prepared_by` **HOẶC** `authUser.userId === meeting.host_id` (OR-rule), để không khóa quyền xóa khi Host của cuộc họp bị đổi sau khi người khác tạo biên bản.
- **[ĐÃ GIẢI QUYẾT] Business Admin xóa hộ có cascade xóa attachment không?** Có — để tránh rác dữ liệu, feature này **cascade soft-delete tất cả `media_files`** có `related_entity_type='meeting_minutes' AND related_entity_id=:minutesId AND deleted_at IS NULL` trong cùng transaction với việc xóa `meeting_minutes`. Chỉ cascade ở tầng DB (set `deleted_at`), **không** xóa file vật lý trên storage (tránh I/O nặng/rủi ro trong transaction; dọn storage vật lý là việc của job riêng, ngoài phạm vi).
- **[ĐÃ GIẢI QUYẾT] System Admin có được xóa không?** Có — dù UC gốc chỉ liệt kê "Business Admin" trong Primary Actor, feature này bổ sung System Admin ngang quyền Business Admin để nhất quán với toàn bộ RBAC của module `minutes` (đã áp dụng ở `feat-list-meeting-minutes`, `feat-view-meeting-minutes-detail`).
- **[ĐÃ GIẢI QUYẾT] Business Admin/System Admin xóa được biên bản của bất kỳ ai, không giới hạn phòng ban/tổ chức con.**
- **[ĐÃ GIẢI QUYẾT] `versionNo` (optimistic lock) có áp dụng cho xóa không?** Không — xóa không có khái niệm "ghi đè nội dung", chỉ cần khóa hàng (`pessimistic_write`) trong lúc xử lý để tránh race với 1 request `PATCH` (update) đang chạy đồng thời.
- **[ĐÃ GIẢI QUYẾT] `status='deleted'` hay chỉ `deleted_at`?** Set **cả hai** cùng lúc: `status = MeetingMinutesStatus.DELETED` VÀ `deleted_at = now()`. Lý do: code hiện tại có 2 kiểu kiểm tra "đã xóa" song song — hầu hết feature (`createDraft`, `addAttachment`,...) check `!minutes || minutes.deletedAt`, còn `feat-list-meeting-minutes` (FR-004) lại lọc theo `status != deleted`. Set cả 2 field đảm bảo tương thích với cả 2 kiểu filter đang tồn tại, tránh phải sửa lại code cũ.
- **[ĐÃ GIẢI QUYẾT] PRE-3 (chỉ xóa được biên bản draft) áp dụng cho MỌI actor, kể cả Admin** — không có ngoại lệ "Admin xóa được cả biên bản đã published".
- **[ĐÃ GIẢI QUYẾT] Notification khi Admin xóa hộ?** Khi actor xóa là Business Admin/System Admin **và** không đồng thời là `prepared_by`/`meeting.hostId` (tức xóa hộ, không phải tự xóa), feature này gửi 1 notification `in_app` cho `prepared_by` (nếu có) báo biên bản của họ đã bị xóa bởi Admin. Khi tự Host xóa biên bản của chính mình, **không** gửi notification.
- **[DEFER]** Dọn file vật lý trên storage cho các attachment bị cascade xóa — để job dọn rác riêng xử lý sau, ngoài phạm vi feature này.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host — `prepared_by` HOẶC `meeting.hostId` hiện tại của cuộc họp.
- **Primary Actor**: Business Admin, System Admin (bypass hoàn toàn ownership check).
- Secondary Actor: Không có.

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.delete` (module_code=`minutes`, action_code=`minutes.delete`), theo đúng tiền tố `meeting.minutes.*` đã dùng cho các permission `minutes` khác (lệch có chủ đích so với `minutes.delete` ghi trong API_CONTRACT, cùng lý do đã áp dụng ở `feat-update-draft-meeting-minutes`).
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Sở hữu permission là điều kiện cần nhưng chưa đủ với `INTERNAL_USER`/`MANAGER`: service còn kiểm tra ownership (mục 2.3). Với `BUSINESS_ADMIN`/`SYSTEM_ADMIN`, permission là đủ (bypass ownership).

### 2.3 Actor Constraints
- `INTERNAL_USER`/`MANAGER` chỉ xóa được khi thỏa `userId === preparedBy OR userId === meeting.hostId`. Participant/Organizer thường (không thỏa điều kiện trên) **không** được xóa (BR2 của UC gốc).
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` xóa được bất kỳ biên bản `draft` nào, không cần thỏa ownership.
- Nếu biên bản không còn `draft` (đã `published`/`archived`), **mọi** actor đều bị từ chối — kể cả Admin.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép soft-delete một `meeting_minutes` đang `status = draft` bởi người thỏa ownership rule (mục 2.3).
- **FR-002**: THE system SHALL set đồng thời `status = deleted` VÀ `deleted_at = now()` khi xóa thành công.
- **FR-003**: THE system SHALL cascade soft-delete (set `deleted_at = now()`) toàn bộ `media_files` đang active có `related_entity_type = 'meeting_minutes' AND related_entity_id = :minutesId` trong cùng transaction với việc xóa `meeting_minutes`.
- **FR-004**: THE system SHALL NOT xóa file vật lý trên storage trong phạm vi feature này (chỉ soft-delete bản ghi DB).

### 3.2 Event-driven Requirements
- **FR-005**: WHEN người dùng gửi `DELETE /api/v1/meeting-minutes/:id`, THE system SHALL kiểm tra tuần tự trong 1 transaction: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi thỏa ownership rule HOẶC có role Admin, (3) biên bản đang `draft`, trước khi ghi.
- **FR-006**: WHEN xóa thành công AND actor là Business Admin/System Admin AND actor KHÔNG đồng thời là `preparedBy`/`meeting.hostId`, THE system SHALL tạo 1 `notifications` (channel=`in_app`, type=`minutes_deleted_by_admin`) gửi cho `preparedBy` (nếu `preparedBy` khác NULL).
- **FR-007**: WHEN xóa thành công AND (actor là `preparedBy` HOẶC actor là `meeting.hostId`), THE system SHALL NOT gửi notification (tự xóa của chính mình, không cần báo).

### 3.3 State-driven Requirements
- **FR-008**: WHILE `meeting_minutes.status != draft`, THE system SHALL từ chối mọi request xóa (kể cả từ Admin), trả `409 MINUTES_NOT_DRAFT`.

### 3.4 Optional Feature Requirements
Không có (feature này không có input body ngoài path param `id`).

### 3.5 Unwanted Behavior Requirements
- **FR-009**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MINUTES_NOT_FOUND`.
- **FR-010**: IF người gọi là `INTERNAL_USER`/`MANAGER` và không thỏa ownership rule (không phải `preparedBy` và không phải `meeting.hostId`), THEN THE system SHALL trả `403 NOT_MINUTES_OWNER`.
- **FR-011**: IF người gọi không có permission `meeting.minutes.delete`, THEN THE system SHALL trả `403 FORBIDDEN`.

### 3.6 Workflow Requirements
- **FR-012**: THE system SHALL khóa hàng (`pessimistic_write`) trên `meeting_minutes` khi bắt đầu transaction xóa, để tránh race condition với 1 request `PATCH` (update) đang chạy đồng thời trên cùng bản ghi.
- **FR-013**: THE system SHALL thực hiện việc soft-delete `meeting_minutes`, cascade soft-delete `media_files`, và ghi audit log trong cùng 1 transaction (ARCH constraint chung của dự án). Notification (FR-006) được tạo NGOÀI transaction (best-effort, không chặn response nếu tạo notification lỗi — nhất quán cách `AuditLogsService` xử lý fail-safe).

### 3.7 Data & State Requirements
- **FR-014**: THE system SHALL không thêm cột/bảng mới vào `meeting_minutes`/`media_files` (đã có sẵn `status`, `deleted_at` trong baseline DB v3.2 Compact).
- **FR-015**: THE system SHALL thêm 1 giá trị enum mới `MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin'` vào `NotificationType` (`src/modules/notifications/entities/notification.entity.ts`) — cột `notification_type` là `varchar(60)` không có CHECK constraint ở DB, nên việc thêm giá trị enum ở tầng TypeScript không cần migration.

### 3.8 Notification / Audit Requirements
- **FR-016**: THE system SHALL ghi 1 bản ghi `audit_logs` (action_type = `meeting_minutes_deleted`, entity_type = `meeting_minutes`) khi xóa thành công, với `oldValueJson` chứa snapshot rút gọn `{title, versionNo, meetingId, preparedBy}` và `metadataJson` chứa `{deletedByRole: 'owner' | 'admin', cascadedAttachmentCount: number}`.
- **FR-017**: Xem FR-006/FR-007 cho quy tắc notification.

### 3.9 Complex / Combined Requirements
- **FR-018**: IF `minutes.status = draft` AND (người gọi thỏa ownership rule HOẶC là Admin), THEN THE system SHALL: soft-delete `meeting_minutes` (set `status=deleted`, `deletedAt=now()`), cascade soft-delete các `media_files` liên quan, ghi audit log, và (nếu là Admin xóa hộ) gửi notification cho `preparedBy` — tất cả trong 1 lần gọi.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002 | POST-1 của UC-MKM-05 gốc + Q&A "status=deleted vs deleted_at" (mục 1.5) |
| FR-003, FR-004 | Q&A "cascade attachment" (mục 1.5) |
| FR-008 | PRE-3 của UC-MKM-05 gốc |
| FR-010 | BR2 của UC-MKM-05 gốc |
| FR-006, FR-007, FR-015 | Q&A "notification khi Admin xóa hộ" (mục 1.5) |
| FR-012 | Q&A "versionNo có áp dụng không" (mục 1.5) |
| FR-016 | POST-2 của UC-MKM-05 gốc |

## 4. Non-functional Requirements

### 4.1 Performance
- API phải phản hồi trong < 500ms ở điều kiện bình thường (1 lock + 1 update + 1 bulk update `media_files` — số lượng attachment tối đa 10 theo `MINUTES_ATTACHMENT_MAX_COUNT`).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) và permission `meeting.minutes.delete`.
- Ownership/Admin-bypass check (mục 2.3) enforce ở tầng service, không tin tưởng tham số phân quyền từ client.

### 4.3 Reliability & Consistency
- Idempotency: gọi lại DELETE cho cùng `minutesId` đã bị xóa trước đó trả `404 MINUTES_NOT_FOUND` (vì `deletedAt` đã set) thay vì lỗi 500 (ARCH-03).
- Cascade soft-delete + audit log trong cùng transaction đảm bảo không có trạng thái "đã xóa minutes nhưng attachment vẫn active".

### 4.4 Usability
- Response trả về đủ thông tin để FE làm mới danh sách/redirect khỏi màn hình chi tiết ngay lập tức.

### 4.5 Observability
- Log đủ thông tin để debug: `minutesId`, `userId`, `deletedByRole` (owner/admin), số lượng attachment bị cascade.

### 4.6 Maintainability
- Business logic đặt trong `MinutesService` (method `deleteDraft`), tái sử dụng logic tính `isOwner` giống `updateDraft` (cân nhắc factor ra 1 hàm chung `resolveMinutesOwnership` nếu 2 method có logic trùng lặp — không bắt buộc trong phạm vi feature này).

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc + lock + ghi (`status`, `deletedAt`).
- `MeetingEntity` (bảng `meetings`) — đọc để lấy `hostId`, không ghi.
- `MediaFileEntity` (bảng `media_files`) — bulk soft-delete các bản ghi liên quan (`relatedEntityType='meeting_minutes'`).
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng audit.
- `NotificationEntity` (bảng `notifications`) — ghi 1 dòng (có điều kiện, FR-006), NGOÀI transaction.

### 5.2 Dữ liệu đầu vào
Path param: `id` (UUID, bắt buộc — id của `meeting_minutes`). Không có request body.

### 5.3 Dữ liệu đầu ra (Response 200)
```jsonc
{
  "success": true,
  "message": "Da xoa bien ban hop nhap thanh cong",
  "data": {
    "deleted": true,
    "minutesId": "uuid",
    "deletedAt": "ISO datetime",
    "cascadedAttachmentCount": 2
  }
}
```

### 5.4 State / Status Model
`meeting_minutes.status`: `draft → deleted` (terminal, không có transition ngược trong phạm vi dự án — không có UC "khôi phục biên bản đã xóa").

### 5.5 Data Constraints
- Chỉ xóa được khi `status = draft` (mọi actor).
- `deleted_at` và `status = deleted` luôn đi cùng nhau sau khi xóa qua feature này (xem mục 1.5).

### 5.6 Data Lifecycle
Tạo (UC-MKM-01) → Chỉnh sửa nhiều lần (UC-MKM-04) → Đính kèm/gỡ tài liệu (song song) → **Xóa mềm (feature này, terminal)** — HOẶC → Ban hành (`feat-issue-meeting-minutes`, ngoài phạm vi, nhánh khác không giao với nhánh xóa vì cả hai đều yêu cầu `status=draft` làm điều kiện, chỉ 1 trong 2 xảy ra trước).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-003, FR-014, FR-015.

## 6. Error Handling

### 6.1 Validation Errors
- `id` (path param) không phải UUID hợp lệ → `400` (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission `meeting.minutes.delete` → `403 FORBIDDEN`.
- Có permission nhưng không thỏa ownership rule (và không phải Admin) → `403 NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → `404 MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `draft` → `409 MINUTES_NOT_DRAFT` (kể cả với Admin).

### 6.4 Conflict Errors
Không có conflict riêng ngoài `MINUTES_NOT_DRAFT` (xem 6.3).

### 6.5 Integration / External Service Errors
Không có (feature này không gọi external service; notification lỗi được xử lý best-effort, không raise lỗi ra response — xem FR-013).

### 6.6 Error Response Expectations
Theo format chuẩn dự án:
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
- **AC-001**: GIVEN biên bản `M` có `status=draft`, `preparedBy=U`, WHEN `U` gọi DELETE, THEN trả `200`, `M.status=deleted`, `M.deletedAt` được set.
- **AC-002**: GIVEN biên bản `M` có `preparedBy=A` nhưng `meeting.hostId=B` (host đã đổi), WHEN `B` gọi DELETE, THEN trả `200` (B được phép vì là host hiện tại).
- **AC-003**: GIVEN biên bản `M` có `preparedBy=A`, WHEN Business Admin `C` gọi DELETE, THEN trả `200` (Admin bypass ownership).
- **AC-004**: GIVEN `M` có 2 attachment active, WHEN xóa `M` thành công, THEN cả 2 `media_files` đó có `deletedAt` được set (`cascadedAttachmentCount=2` trong response), file vật lý trên storage KHÔNG bị xóa.

### 7.2 Authorization Cases
- **AC-005**: GIVEN người gọi là Participant của meeting (không phải `preparedBy`, không phải `meeting.hostId`, không phải Admin), WHEN gọi DELETE, THEN trả `403 NOT_MINUTES_OWNER`.
- **AC-006**: GIVEN người gọi không có permission `meeting.minutes.delete`, WHEN gọi DELETE, THEN trả `403 FORBIDDEN`.
- **AC-007**: GIVEN người gọi là System Admin, WHEN gọi DELETE cho biên bản `draft` bất kỳ, THEN trả `200` (ngang quyền Business Admin).

### 7.3 Business Rule Cases
- **AC-008**: GIVEN biên bản `M` có `status=published`, WHEN Business Admin gọi DELETE, THEN trả `409 MINUTES_NOT_DRAFT` (kể cả Admin cũng không xóa được).

### 7.4 Validation Cases
- **AC-009**: GIVEN `id` không phải UUID hợp lệ, WHEN gọi DELETE, THEN trả `400`.

### 7.5 State Transition / Idempotency Cases
- **AC-010**: GIVEN `M` đã bị xóa mềm trước đó, WHEN gọi lại DELETE cùng `id`, THEN trả `404 MINUTES_NOT_FOUND` (không phải 200 lặp lại).
- **AC-011**: GIVEN `M` không tồn tại (`id` ngẫu nhiên hợp lệ UUID), WHEN gọi DELETE, THEN trả `404 MINUTES_NOT_FOUND`.

### 7.6 Notification / Audit Cases
- **AC-012**: GIVEN `U = preparedBy` tự xóa biên bản của chính mình, WHEN xóa thành công, THEN KHÔNG có `notifications` nào được tạo.
- **AC-013**: GIVEN Business Admin (không phải `preparedBy`/`hostId`) xóa biên bản của Host `A`, WHEN xóa thành công, THEN có đúng 1 `notifications` mới (`type=minutes_deleted_by_admin`, gửi cho `A`).
- **AC-014**: GIVEN xóa thành công (bất kỳ actor nào), THEN có đúng 1 `audit_logs` mới với `action_type=meeting_minutes_deleted`.

### 7.7 Concurrency Cases
- **AC-015**: GIVEN `M` đang được `PATCH` (update) bởi request khác gần như đồng thời, WHEN request DELETE và request PATCH cùng chạy, THEN 1 trong 2 hoàn tất trước (nhờ lock `pessimistic_write`), request còn lại nhận kết quả nhất quán (nếu DELETE thắng trước: PATCH sau đó nhận `404 MINUTES_NOT_FOUND` vì `deletedAt` đã set; nếu PATCH thắng trước: DELETE vẫn xóa được vì `status` vẫn là `draft`).

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-002 |
| AC-002, AC-003, AC-007 | FR-005, FR-010 (ownership rule mở rộng) |
| AC-004 | FR-003, FR-004 |
| AC-005 | FR-010 |
| AC-006 | Permission guard (mục 2.2) |
| AC-008 | FR-008 |
| AC-010, AC-011 | FR-009 |
| AC-012, AC-013 | FR-006, FR-007 |
| AC-014 | FR-016 |
| AC-015 | FR-012 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Khôi phục biên bản đã xóa (undo/restore).
- Xóa file vật lý trên storage cho attachment bị cascade (chỉ soft-delete DB).
- Xóa biên bản đã `published`/`archived` (thuộc feature khác nếu có yêu cầu, hiện chưa có UC nào cho phép).
- Xác nhận 2 bước ở BE (dialog cảnh báo là UX của FE, BE chỉ có 1 endpoint DELETE trực tiếp).
- Giới hạn phạm vi Business Admin/System Admin theo phòng ban.

### 8.2 Có thể xem xét ở feature khác
- Job dọn rác file vật lý trên storage cho `media_files` đã soft-delete lâu ngày (không riêng cho feature này).
- `feat-issue-meeting-minutes` (ban hành) — nhánh khác của cùng điều kiện `status=draft`, không giao với feature xóa.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cung cấp endpoint khôi phục (`restore`) cho `meeting_minutes` trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT xóa file vật lý trên storage trong phạm vi feature này.
- **FR-OOS-003**: THE system SHALL NOT cho phép xóa biên bản có `status != draft`, kể cả với Business Admin/System Admin.

## Assumptions
Xem mục 1.4 và 1.5.
