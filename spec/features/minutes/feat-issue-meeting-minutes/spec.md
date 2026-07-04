# Feature Specification: Ban hành biên bản họp chính thức (Issue Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-09, sau vòng thảo luận + Q&A trực tiếp với Product Owner để chốt model phân quyền, điều kiện publish, và notification | Toàn bộ file |

> Nguồn gốc: UC-MKM-09 "Ban hành biên bản họp chính thức" (Feature Table gốc, do người dùng cung cấp trực tiếp). Đây là feature đã được 3 spec trước đó (`feat-create-draft-meeting-minutes`, `feat-view-meeting-minutes-detail`, `feat-attach-minutes-document`) nhắc tới bằng đúng tên `feat-issue-meeting-minutes` trong mục "Có thể xem xét ở feature khác" — feature này chính thức hóa tên đó. Spec chuẩn hóa UC gốc (dùng wording `DRAFT`/`OFFICIAL` không khớp enum thực tế `draft`/`published`, `Exceptions: N/A`, `Other Information: N/A`) theo baseline code hiện có và các quyết định đã chốt qua Q&A (xem mục 1.5, `research.md`).

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi biên bản họp nháp đã được soạn thảo đầy đủ (`feat-create-draft-meeting-minutes`, `feat-update-draft-meeting-minutes`) và đính kèm tài liệu nếu cần (`feat-attach-minutes-document`), Host hoặc Business Admin cần "chốt" nội dung này thành bản chính thức — khóa chỉnh sửa vĩnh viễn và công bố cho những người liên quan (participant) được xem. Đây là bước cuối trong vòng đời soạn thảo biên bản (`draft → published`), lần đầu tiên nội dung biên bản "mở" ra ngoài phạm vi riêng tư của người soạn.

### 1.2 Mục tiêu
Cung cấp 1 endpoint `POST` cho phép người có quyền (Host — `prepared_by` HOẶC `meeting.hostId` — hoặc Business Admin/System Admin) chuyển 1 `meeting_minutes` từ `draft` sang `published`, ghi nhận người/thời điểm ban hành (`issued_by`/`issued_at`), và thông báo cho toàn bộ participant của cuộc họp.

### 1.3 Giá trị mang lại
- Hoàn thiện vòng đời CRUD + publish của biên bản (tạo → sửa → đính kèm → **ban hành** → [xóa nếu còn draft]).
- Khóa nội dung chính thức, đảm bảo tính toàn vẹn dữ liệu sau khi công bố (không ai chỉnh sửa được nữa, kể cả người soạn).
- Kích hoạt lần đầu tiên notification `minutes_distribution` — giá trị enum đã tồn tại sẵn trong `NotificationType` từ trước nhưng chưa từng được dùng tới.

### 1.4 Giả định
- Biên bản (`meeting_minutes`) đã tồn tại, đang ở `status = draft`.
- `OFFICIAL` (wording trong UC gốc) = `MeetingMinutesStatus.PUBLISHED` (`'published'`) trong entity thật — không tạo giá trị enum mới.
- Chỉ set `issued_by`/`issued_at` khi ban hành — **không** đụng tới `approved_by`/`approved_at` (2 cột này dành cho 1 bước duyệt riêng biệt, nếu có, thuộc feature khác ngoài phạm vi UC-MKM-09).
- `visibility_level` giữ nguyên `private` khi publish — field này hiện KHÔNG được bất kỳ logic phân quyền nào đọc tới (đã xác nhận ở `feat-list-meeting-minutes`/`feat-view-meeting-minutes-detail`: quyền xem `published`/`archived` hoàn toàn dựa vào `status` + quan hệ host/participant của `meetings`/`meeting_participants`, không dựa vào `visibility_level`). Đổi hay không đổi field này đều không ảnh hưởng chức năng thực tế.
- Publish **không** có khái niệm optimistic lock (`versionNo`) — hành động này không ghi đè nội dung do client gửi lên, chỉ chuyển trạng thái của bản ghi hiện có trong DB, không tồn tại "conflict" cần chặn theo nghĩa của `feat-update-draft-meeting-minutes`.
- Việc "khóa chỉnh sửa hoàn toàn" (POST-2 của UC gốc) **không cần code mới** trong feature này — đã tự động được đảm bảo bởi guard `MINUTES_NOT_DRAFT` đã có sẵn ở `feat-update-draft-meeting-minutes` (FR-009) và `feat-attach-minutes-document` (FR-007): cả 2 feature đó đều từ chối thao tác ghi khi `status != draft`.

### 1.5 Cần làm rõ — đã giải quyết qua Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] "Host" nghĩa là gì?** OR-rule giống `update`/`delete`: `authUser.userId === meeting_minutes.prepared_by` HOẶC `authUser.userId === meeting.host_id`.
- **[ĐÃ GIẢI QUYẾT] System Admin có ngang Business Admin không?** Có — bổ sung để nhất quán RBAC toàn module `minutes` (UC gốc chỉ ghi Business Admin, cùng pattern deviation đã lặp lại ở các feature trước).
- **[ĐÃ GIẢI QUYẾT] PRE-3 ("nội dung đã điền đầy đủ")**: KHÔNG enforce ở BE — không có tiêu chí khách quan để kiểm tra (`minutesContent` luôn có sẵn khung mặc định không rỗng ngay từ lúc tạo draft). Coi là gợi ý UX cho FE.
- **[ĐÃ GIẢI QUYẾT] Điều kiện `meeting.status`**: bắt buộc `meeting.status = completed` mới cho phép publish — không cho publish khi meeting còn `in_progress`/`scheduled`/`cancelled`/etc. Đây là rào an toàn hợp lý bổ sung (UC gốc không nhắc), tránh "chốt chính thức" biên bản trong khi cuộc họp chưa kết thúc.
- **[ĐÃ GIẢI QUYẾT] `approved_by`/`approved_at`**: KHÔNG set trong feature này (xem mục 1.4).
- **[ĐÃ GIẢI QUYẾT] `visibility_level`**: giữ nguyên, không đổi (xem mục 1.4).
- **[ĐÃ GIẢI QUYẾT] Notification khi publish**: CÓ — gửi 1 notification `type = minutes_distribution` (giá trị enum đã tồn tại sẵn, chưa từng dùng) tới toàn bộ participant của cuộc họp (trừ chính người thực hiện publish), báo biên bản đã được ban hành.
- **[ĐÃ GIẢI QUYẾT] Nguồn danh sách người nhận notification**: query trực tiếp `meeting_participants` tại thời điểm publish (KHÔNG dùng `attendees_snapshot_json` đã đóng băng từ lúc tạo draft, vì snapshot đó có thể lỗi thời nếu chưa từng được refresh qua `feat-update-draft-meeting-minutes`).
- **[ĐÃ GIẢI QUYẾT] Mâu thuẫn kỹ thuật cần theo dõi**: `feat-view-meeting-minutes-detail` (UC-MKM-03, FR-017) đã định nghĩa `permissions.canIssue = (status===draft) AND (isAdmin OR preparedBy===userId)` — thiếu nhánh `meeting.hostId` (cùng loại vấn đề đã flag ở `canEdit` khi làm `feat-update-draft-meeting-minutes`). Ghi chú lại ở đây, KHÔNG sửa file đó (ngoài phạm vi worktree hiện tại) — xem `research.md` mục 3.

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host — `prepared_by` HOẶC `meeting.hostId` hiện tại của cuộc họp.
- **Primary Actor**: Business Admin, System Admin (bypass hoàn toàn ownership check).
- Secondary Actor: Không có.

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.issue` (module_code=`minutes`, action_code=`minutes.issue`).
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (theo đúng pattern cấp rộng đã dùng cho `meeting.minutes.create`/`meeting.minutes.delete` — sở hữu permission là điều kiện cần nhưng chưa đủ, service còn kiểm tra ownership).
- `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass ownership; `INTERNAL_USER`/`MANAGER` phải thỏa ownership rule (mục 2.3).

### 2.3 Actor Constraints
- `INTERNAL_USER`/`MANAGER` chỉ publish được khi thỏa `userId === preparedBy OR userId === meeting.hostId`. Participant/Organizer thường (không thỏa) **không** được publish.
- Nếu biên bản không còn `draft` (đã `published`/`archived`), **mọi** actor đều bị từ chối — kể cả Admin (idempotency: publish lại 1 bản đã published trả lỗi, không phải no-op thành công).
- Nếu `meeting.status != completed`, **mọi** actor đều bị từ chối — kể cả Admin.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL chuyển `meeting_minutes.status` từ `draft` sang `published` khi publish thành công.
- **FR-002**: THE system SHALL gán `issued_by = <userId của actor>` và `issued_at = now()` khi publish thành công.
- **FR-003**: THE system SHALL KHÔNG thay đổi `approved_by`, `approved_at`, `visibility_level`, `version_no`, `minutes_content`, `decisions_json`, `action_items_json` khi publish (chỉ đổi `status`/`issued_by`/`issued_at`).

### 3.2 Event-driven Requirements
- **FR-004**: WHEN người dùng gửi `POST /api/v1/meeting-minutes/:id/issue`, THE system SHALL kiểm tra tuần tự trong 1 transaction: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi thỏa ownership rule HOẶC có role Admin, (3) biên bản đang `draft`, (4) `meeting.status = completed`, trước khi ghi.
- **FR-005**: WHEN publish thành công, THE system SHALL truy vấn `meeting_participants` tại thời điểm publish (không dùng snapshot cũ) để lấy danh sách `userId` cần thông báo.
- **FR-006**: WHEN publish thành công AND danh sách participant khác rỗng, THE system SHALL tạo 1 `notifications` (`type = minutes_distribution`, `channel = in_app`) gửi cho toàn bộ participant TRỪ chính actor vừa thực hiện publish.

### 3.3 State-driven Requirements
- **FR-007**: WHILE `meeting_minutes.status != draft`, THE system SHALL từ chối mọi request publish (kể cả từ Admin), trả `409 MINUTES_NOT_DRAFT`.
- **FR-008**: WHILE `meeting.status != completed`, THE system SHALL từ chối publish, trả `409 MEETING_NOT_COMPLETED`.

### 3.4 Optional Feature Requirements
Không có (feature này không có input body ngoài path param `id`).

### 3.5 Unwanted Behavior Requirements
- **FR-009**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MINUTES_NOT_FOUND`.
- **FR-010**: IF người gọi là `INTERNAL_USER`/`MANAGER` và không thỏa ownership rule, THEN THE system SHALL trả `403 NOT_MINUTES_OWNER`.
- **FR-011**: IF người gọi không có permission `meeting.minutes.issue`, THEN THE system SHALL trả `403 FORBIDDEN`.

### 3.6 Workflow Requirements
- **FR-012**: THE system SHALL khóa hàng (`pessimistic_write`) trên `meeting_minutes` khi bắt đầu transaction publish, để tránh race condition với 1 request `PATCH` (update) hoặc `DELETE` đang chạy đồng thời trên cùng bản ghi.
- **FR-013**: THE system SHALL thực hiện việc chuyển trạng thái `meeting_minutes` và ghi audit log trong cùng 1 transaction. Notification (FR-006) được tạo NGOÀI transaction (best-effort, không chặn response nếu tạo notification lỗi — nhất quán cách xử lý fail-safe đã áp dụng ở `feat-delete-draft-meeting-minutes`).

### 3.7 Data & State Requirements
- **FR-014**: THE system SHALL không thêm cột/bảng mới (`issued_by`, `issued_at` đã có sẵn trong baseline DB v3.2 Compact; `NotificationType.MINUTES_DISTRIBUTION` đã tồn tại sẵn trong entity, không cần thêm giá trị enum mới — khác với `feat-delete-draft-meeting-minutes` trước đó phải thêm 1 giá trị enum mới).

### 3.8 Notification / Audit Requirements
- **FR-015**: THE system SHALL ghi 1 bản ghi `audit_logs` (action_type = `meeting_minutes_issued`, entity_type = `meeting_minutes`) khi publish thành công, với `oldValueJson = {status: 'draft'}`, `newValueJson = {status: 'published', issuedBy, issuedAt}`.
- **FR-016**: Xem FR-005/FR-006 cho quy tắc notification.
- **FR-017**: WHILE danh sách participant (trừ actor) rỗng, THE system SHALL NOT tạo notification nào (tránh tạo bản ghi `notifications` với `recipient_user_ids_json = []` vô nghĩa).

### 3.9 Complex / Combined Requirements
- **FR-018**: IF `minutes.status = draft` AND `meeting.status = completed` AND (người gọi thỏa ownership rule HOẶC là Admin), THEN THE system SHALL: chuyển `status = published`, set `issuedBy`/`issuedAt`, ghi audit log, và gửi notification `minutes_distribution` cho participant (nếu có) — tất cả trong 1 lần gọi.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-002 | POST-1 của UC-MKM-09 gốc + Q&A "mapping OFFICIAL=published" (mục 1.5) |
| FR-003 | Q&A "approved_by/visibility_level không đổi" (mục 1.5) |
| FR-007 | PRE-2 của UC-MKM-09 gốc |
| FR-008 | Q&A "điều kiện meeting.status" (mục 1.5) |
| FR-010 | PRE-1 của UC-MKM-09 gốc + Q&A "ai được publish" (mục 1.5) |
| FR-005, FR-006, FR-017 | Q&A "notification minutes_distribution" (mục 1.5) |
| FR-012 | Kế thừa pattern lock từ `feat-update-draft-meeting-minutes`/`feat-delete-draft-meeting-minutes` |
| — (không cần FR riêng) | POST-2 của UC-MKM-09 gốc — đã cover bởi guard có sẵn (xem mục 1.4) |

## 4. Non-functional Requirements

### 4.1 Performance
- API phải phản hồi trong < 500ms ở điều kiện bình thường (1 lock + 1 update + 1 lần đọc `meeting_participants`).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) và permission `meeting.minutes.issue`.
- Ownership/Admin-bypass check enforce ở tầng service, không tin tưởng tham số phân quyền từ client.

### 4.3 Reliability & Consistency
- Idempotency: gọi lại publish cho bản đã `published` trả `409 MINUTES_NOT_DRAFT` thay vì `200` lặp lại (ARCH-03).
- Notification lỗi không làm fail response (feature đã hoàn thành ở tầng DB, xem 9.3 của plan.md).

### 4.4 Usability
- Response trả về đủ dữ liệu để FE chuyển ngay UI sang chế độ hiển thị bản chính thức, ẩn nút "Chỉnh sửa"/"Ban hành" (BR1 của UC gốc — trách nhiệm FE dựa trên field `status` trả về).

### 4.5 Observability
- Log đủ thông tin để debug: `minutesId`, `userId`, kết quả (success/lỗi + code), số lượng notification đã gửi.

### 4.6 Maintainability
- Business logic đặt trong `MinutesService` (method `issueMinutes`), tái sử dụng logic tính `isOwner`/`isAdmin` tương tự `updateDraft`/`deleteDraft` (cân nhắc factor ra hàm chung nếu logic lặp lại quá nhiều lần qua các feature — không bắt buộc trong phạm vi feature này).

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc + lock + ghi (`status`, `issuedBy`, `issuedAt`).
- `MeetingEntity` (bảng `meetings`) — đọc `hostId`/`status`, không ghi.
- `MeetingParticipantEntity` (bảng `meeting_participants`) — đọc để lấy danh sách người nhận notification.
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng audit.
- `NotificationEntity` (bảng `notifications`) — ghi 1 dòng (có điều kiện, FR-017), NGOÀI transaction.

### 5.2 Dữ liệu đầu vào
Path param: `id` (UUID, bắt buộc — id của `meeting_minutes`). Không có request body.

### 5.3 Dữ liệu đầu ra (Response 200)
```jsonc
{
  "success": true,
  "message": "Ban hanh bien ban cuoc hop thanh cong",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "string",
    "status": "published",
    "versionNo": 2,
    "issuedBy": "uuid",
    "issuedAt": "ISO datetime",
    "updatedAt": "ISO datetime",
    "notifiedParticipantCount": 4
  }
}
```

### 5.4 State / Status Model
`meeting_minutes.status`: `draft → published` (feature này chỉ tạo transition này). `published → archived` thuộc feature khác (chưa tồn tại, ngoài phạm vi). `published` là trạng thái không còn chỉnh sửa/xóa được qua các feature `update`/`delete`/`attach` đã có (đã tự động enforce, xem mục 1.4).

### 5.5 Data Constraints
- Chỉ publish được khi `status = draft` AND `meeting.status = completed` (cả 2 điều kiện AND, không OR).
- Sau khi publish, `status = published` là bước đầu tiên của nhánh "chính thức" trong vòng đời — không có transition ngược lại `draft` trong phạm vi dự án hiện tại (không có UC "hủy ban hành/rút biên bản").

### 5.6 Data Lifecycle
Tạo (UC-MKM-01) → Chỉnh sửa nhiều lần (UC-MKM-04) → Đính kèm/gỡ tài liệu (song song) → **Ban hành (feature này, terminal cho nhánh chỉnh sửa)** → (ngoài phạm vi) Lưu trữ (`archived`). Nhánh khác của cùng điều kiện `status=draft`: **Xóa mềm** (UC-MKM-05) — 2 nhánh loại trừ nhau (biên bản chỉ có thể publish HOẶC xóa, không thể cả hai vì mỗi thao tác đều yêu cầu `status=draft` làm điều kiện tiên quyết và tự chuyển trạng thái ra khỏi `draft`).

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-002, FR-003, FR-014.

## 6. Error Handling

### 6.1 Validation Errors
- `id` (path param) không phải UUID hợp lệ → `400` (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission `meeting.minutes.issue` → `403 FORBIDDEN`.
- Có permission nhưng không thỏa ownership rule (và không phải Admin) → `403 NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → `404 MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `draft` → `409 MINUTES_NOT_DRAFT` (kể cả với Admin).
- Cuộc họp chưa `completed` → `409 MEETING_NOT_COMPLETED` (kể cả với Admin).

### 6.4 Conflict Errors
Xem 6.3 (`MINUTES_NOT_DRAFT`, `MEETING_NOT_COMPLETED`).

### 6.5 Integration / External Service Errors
Không có (notification lỗi được xử lý best-effort, không raise lỗi ra response — xem FR-013).

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
- **AC-001**: GIVEN biên bản `M` có `status=draft`, `preparedBy=U`, `meeting.status=completed`, WHEN `U` gọi POST issue, THEN trả `200`, `M.status=published`, `M.issuedBy=U`, `M.issuedAt` được set.
- **AC-002**: GIVEN biên bản `M` có `preparedBy=A` nhưng `meeting.hostId=B` (host đã đổi), WHEN `B` gọi issue, THEN trả `200` (B được phép vì là host hiện tại).
- **AC-003**: GIVEN biên bản `M` có `preparedBy=A`, WHEN Business Admin `C` gọi issue, THEN trả `200` (Admin bypass ownership).
- **AC-004**: GIVEN `M` có 3 participant (không tính actor), WHEN publish thành công, THEN có đúng 1 `notifications` mới với `recipient_user_ids_json` chứa đúng 3 userId đó, `notification_type=minutes_distribution`.

### 7.2 Authorization Cases
- **AC-005**: GIVEN người gọi là Participant của meeting (không phải `preparedBy`/`meeting.hostId`/Admin), WHEN gọi issue, THEN trả `403 NOT_MINUTES_OWNER`.
- **AC-006**: GIVEN người gọi không có permission `meeting.minutes.issue`, WHEN gọi issue, THEN trả `403 FORBIDDEN`.
- **AC-007**: GIVEN người gọi là System Admin, WHEN gọi issue cho biên bản `draft` bất kỳ (meeting đã completed), THEN trả `200` (ngang quyền Business Admin).

### 7.3 Business Rule Cases
- **AC-008**: GIVEN biên bản `M` có `status=published` (đã publish trước đó), WHEN gọi lại issue, THEN trả `409 MINUTES_NOT_DRAFT` (kể cả với Admin).
- **AC-009**: GIVEN `meeting.status=in_progress` (chưa kết thúc), WHEN Host gọi issue, THEN trả `409 MEETING_NOT_COMPLETED`.
- **AC-010**: GIVEN `meeting.status=cancelled`, WHEN Host gọi issue, THEN trả `409 MEETING_NOT_COMPLETED` (dùng chung code, không phân biệt lý do).

### 7.4 Validation Cases
- **AC-011**: GIVEN `id` không phải UUID hợp lệ, WHEN gọi issue, THEN trả `400`.

### 7.5 State Transition Cases
- **AC-012**: GIVEN `M` không tồn tại (`id` ngẫu nhiên hợp lệ UUID), WHEN gọi issue, THEN trả `404 MINUTES_NOT_FOUND`.
- **AC-013**: GIVEN sau khi publish thành công, WHEN gọi `PATCH` (update) hoặc `DELETE` cho cùng `minutesId`, THEN trả `409 MINUTES_NOT_DRAFT` (xác nhận khóa chỉnh sửa/xóa hoạt động đúng, dùng guard có sẵn — không phải code mới của feature này).

### 7.6 Notification / Audit Cases
- **AC-014**: GIVEN `M` không có participant nào (0 người, chỉ có preparedBy), WHEN publish thành công, THEN KHÔNG có `notifications` nào được tạo (FR-017).
- **AC-015**: GIVEN publish thành công (bất kỳ actor nào), THEN có đúng 1 `audit_logs` mới với `action_type=meeting_minutes_issued`.
- **AC-016**: GIVEN actor tự publish và đồng thời là participant của chính cuộc họp đó, WHEN publish thành công, THEN `recipient_user_ids_json` của notification KHÔNG chứa `actor.userId` (loại trừ chính người thực hiện).

### 7.7 Concurrency Cases
- **AC-017**: GIVEN `M` đang được `PATCH` (update) bởi request khác gần như đồng thời, WHEN request issue và request PATCH cùng chạy, THEN nhờ lock `pessimistic_write`, 1 trong 2 hoàn tất trước; nếu PATCH thắng trước, issue vẫn thành công (vì `status` vẫn `draft`); nếu issue thắng trước, PATCH sau đó nhận `409 MINUTES_NOT_DRAFT`.

### 7.8 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001 | FR-001, FR-002 |
| AC-002, AC-003, AC-007 | FR-004, FR-010 |
| AC-004, AC-016 | FR-005, FR-006 |
| AC-005 | FR-010 |
| AC-006 | Permission guard (mục 2.2) |
| AC-008 | FR-007 |
| AC-009, AC-010 | FR-008 |
| AC-011 | Validation (ParseUUIDPipe) |
| AC-012 | FR-009 |
| AC-013 | Guard có sẵn (mục 1.4, không phải FR mới) |
| AC-014 | FR-017 |
| AC-015 | FR-015 |
| AC-017 | FR-012 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Bước duyệt (`approved_by`/`approved_at`) tách biệt với ban hành — nếu cần, làm feature riêng.
- Lưu trữ biên bản (`published → archived`) — chưa có UC nào cho phép, ngoài phạm vi.
- Hủy ban hành/rút biên bản đã publish về lại `draft` — không có trong UC gốc, không implement.
- Kích hoạt `visibility_level` làm cơ sở phân quyền mới (giữ nguyên hiện trạng chưa dùng field này).
- Gửi notification qua kênh `email` (chỉ `in_app` trong phạm vi feature này).
- Cập nhật lại công thức `permissions.canIssue`/`canEdit` của `feat-view-meeting-minutes-detail` (UC-MKM-03) cho khớp ownership rule mới — ngoài phạm vi worktree hiện tại (xem mục 1.5).

### 8.2 Có thể xem xét ở feature khác
- `feat-approve-meeting-minutes` (nếu cần bước duyệt riêng trước khi ban hành).
- `feat-archive-meeting-minutes` (published → archived).
- Đồng bộ lại `feat-view-meeting-minutes-detail` để sửa công thức `canIssue`/`canEdit`.
- Gửi notification qua email cho `minutes_distribution` (mở rộng channel).

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT cung cấp endpoint chuyển `published` về lại `draft` trong phạm vi feature này.
- **FR-OOS-002**: THE system SHALL NOT set `approved_by`/`approved_at` trong phạm vi feature này.
- **FR-OOS-003**: THE system SHALL NOT gửi notification qua kênh `email`/`sms` trong phạm vi feature này (chỉ `in_app`).
- **FR-OOS-004**: THE system SHALL NOT cho phép publish khi `meeting.status != completed`, kể cả với Business Admin/System Admin.

## Assumptions
Xem mục 1.4 và 1.5.
