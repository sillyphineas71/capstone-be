# Feature Specification: Cập nhật nội dung biên bản họp nháp (Update Draft Meeting Minutes)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo spec cho UC-MKM-04 (khớp UC-132 trong API_CONTRACT_v1.0_with_system_roles.md), sau vòng gap-analysis + Q&A trực tiếp với Product Owner để chốt các điểm mơ hồ | Toàn bộ file |

> Nguồn gốc: UC-MKM-04 "Cập nhật nội dung biên bản họp" (Feature Table gốc, do người dùng cung cấp trực tiếp) + UC-132 "Cập nhật nội dung biên bản họp" trong `docs/API_CONTRACT_v1.0_with_system_roles.md` (dòng 4377-4399). Spec này chuẩn hóa lại UC gốc (vốn ghi `Exceptions: N/A`, `Other Information: N/A` và không định nghĩa concurrency/schema JSON) theo đúng baseline code hiện có (`MeetingMinutesEntity`, `feat-create-draft-meeting-minutes` UC-MKM-01, `feat-attach-minutes-document`) và các quyết định đã chốt trực tiếp với Product Owner (xem mục 1.5 và `research.md`).

## 1. Context & Goal

### 1.1 Bối cảnh
Sau khi biên bản họp nháp được tạo (`feat-create-draft-meeting-minutes`, UC-MKM-01), Host cần chỉnh sửa nội dung nhiều lần trước khi ban hành: bổ sung kết luận, quyết định (`decisions_json`), điều chỉnh danh sách đầu việc (`action_items_json`), hoặc đổi tiêu đề. Feature này bổ sung bước "chỉnh sửa nội dung" còn thiếu trong vòng đời biên bản (`draft → published/issued`, xem UC-MKM-01 mục 5.4), tách biệt hoàn toàn khỏi việc đính kèm tài liệu (đã có API riêng ở `feat-attach-minutes-document`).

### 1.2 Mục tiêu
Cung cấp 1 endpoint `PATCH` cho phép **đúng một người** (người đã tạo biên bản, hoặc Host hiện tại của cuộc họp — xem mục 1.5) cập nhật `title`/`minutesContent`/`decisionsJson`/`actionItemsJson` của một biên bản đang ở trạng thái `draft`, có cơ chế chống ghi đè dữ liệu khi có nhiều phiên chỉnh sửa gần như đồng thời (optimistic locking qua `versionNo`), và giữ nguyên trạng thái `draft` sau khi lưu (đúng POST-2 của UC gốc).

### 1.3 Giá trị mang lại
- Hoàn thiện luồng soạn thảo biên bản mà UC-MKM-01 đã để ngỏ ("Cơ chế cập nhật nội dung biên bản nháp" — xem UC-MKM-01 mục 1.5).
- Tránh mất dữ liệu do ghi đè khi Host mở nhiều tab/phiên làm việc.
- Chuẩn hóa cấu trúc `decisions_json`/`action_items_json` (JSON tự do trong DB) để FE và các feature sau (ban hành, xem chi tiết) dùng chung 1 schema.

### 1.4 Giả định
- Biên bản họp (`meeting_minutes`) đã tồn tại, tạo qua `feat-create-draft-meeting-minutes` (UC-MKM-01), đang ở `status = draft`.
- Không chỉnh sửa `visibility_level` trong feature này — đã có endpoint riêng theo UC-136 (`PATCH /minutes/:id/visibility`, ngoài phạm vi).
- Không xử lý file đính kèm trong feature này — đã có 3 endpoint riêng theo `feat-attach-minutes-document` (`POST/GET/DELETE meeting-minutes/:minutesId/attachments`).
- Endpoint và cấu trúc response theo đúng convention đã dùng ở 3 spec `minutes` trước (`meeting-minutes` làm route prefix), **không** theo đúng literal path `/api/v1/minutes/{minutesId}` ghi trong UC-132 của API_CONTRACT — xem lý do lệch ở mục 1.5.
- `MeetingMinutesEntity.versionNo` (cột đã có sẵn trong baseline, mặc định `1`) được dùng làm cơ chế optimistic locking cho feature này — chưa có feature nào khác đọc/ghi ý nghĩa "concurrency" của cột này trước đây (UC-MKM-01 chỉ khởi tạo `versionNo = 1` mặc định, không tăng).

### 1.5 Cần làm rõ — đã giải quyết qua Q&A trực tiếp với Product Owner
- **[ĐÃ GIẢI QUYẾT] Ai được sửa?** Chỉ **Host** — cụ thể là `authUser.userId === meeting_minutes.prepared_by` **HOẶC** `authUser.userId === meeting.host_id` (chấp nhận cả 2, phòng trường hợp Host của cuộc họp bị đổi sau khi biên bản đã được người khác tạo). Business Admin/System Admin **KHÔNG** được bypass quyền edit trong feature này, dù có permission `meeting.minutes.update`.
  - **Ghi chú xung đột cần theo dõi:** `feat-view-meeting-minutes-detail` (UC-MKM-03, FR-017) đã định nghĩa `permissions.canEdit = (status===draft) AND (isAdmin OR preparedBy===userId)` — tức ngầm định Admin cũng edit được. Quyết định của feature này (Admin không được sửa) khác với công thức đó. Đây là **out-of-scope discrepancy**: khi implement UC-MKM-03 thật (hiện chưa có controller trong code), cần cập nhật lại công thức `canEdit` cho khớp rule thật của feature này (bỏ nhánh `isAdmin`, thêm nhánh `meeting.hostId === userId`). Không sửa file spec của UC-MKM-03 trong phạm vi feature này (đang ở worktree chỉ được sửa `feat-update-draft-meeting-minutes/`).
- **[ĐÃ GIẢI QUYẾT] Có xử lý file đính kèm trong UC-MKM-04 không?** Không. Description của UC gốc nhắc "đính kèm thêm tài liệu" nhưng đã có API riêng (`feat-attach-minutes-document`) — feature này chỉ cập nhật nội dung text/JSON.
- **[ĐÃ GIẢI QUYẾT] Autosave 5 giây?** Không thuộc phạm vi feature này. UC-MKM-04 (bản UC gốc do người dùng cung cấp) chỉ mô tả nút "Lưu thay đổi" thủ công — feature này chỉ implement save thủ công qua PATCH khi FE gọi API (có thể debounce ở FE, nhưng đó là quyết định FE, không phải BE tự động lưu định kỳ).
- **[ĐÃ GIẢI QUYẾT] Concurrency?** Dùng optimistic locking qua `versionNo`: request bắt buộc gửi kèm `versionNo` đang sửa; nếu lệch với DB → `409 MINUTES_VERSION_CONFLICT`.
- **[ĐÃ GIẢI QUYẾT] Partial hay full update?** Partial update (PATCH) — chỉ field nào FE gửi lên mới bị ghi đè; field không gửi giữ nguyên giá trị cũ. Phải có ít nhất 1 trong 4 field `title/minutesContent/decisionsJson/actionItemsJson` trong request.
- **[ĐÃ GIẢI QUYẾT] Refresh `attendees_snapshot_json`?** Có, nhưng chỉ khi `meeting.status = completed` tại thời điểm update — feature này tự động re-tính lại snapshot từ `meeting_participants` mới nhất mỗi lần update thành công trong điều kiện đó (không refresh khi meeting còn `in_progress`, tránh so sánh version phức tạp không cần thiết).
- **[ĐÃ GIẢI QUYẾT] Schema `decisions_json`/`action_items_json`?** Theo đúng ví dụ đã có sẵn trong UC-132 của `API_CONTRACT_v1.0_with_system_roles.md` (xem mục 5.2), bổ sung thêm `id` tự sinh cho mỗi action item để các feature sau (ví dụ "đánh dấu hoàn thành đầu việc") có thể tham chiếu.
- **[DEFER]** `visibilityLevel` trong body ví dụ của UC-132 — feature này **không** nhận field này (xem mục 1.4), để dành cho UC-136 (`feat-update-minutes-visibility`, chưa tồn tại).

## 2. Actor & Roles

### 2.1 Danh sách actor
- **Primary Actor**: Internal Employee giữ vai trò Host của cuộc họp — cụ thể là người đã soạn biên bản (`prepared_by`) hoặc Host hiện tại của meeting (`meeting.host_id`), xem mục 1.5.
- Secondary Actor: Không có (Business Admin/System Admin có permission gọi API nhưng bị chặn ở tầng ownership — xem mục 2.3).

### 2.2 Role & Permission Rules
- Permission code mới: `meeting.minutes.update` (module_code=`minutes`, action_code=`minutes.update`), theo đúng pattern đặt tên đã dùng cho `meeting.minutes.create`/`meeting.minutes.read`/`meeting.minutes.attachment.*` (tiền tố `meeting.` — lưu ý điều này **lệch** so với tên `minutes.update` ghi trong bảng permission ở API_CONTRACT dòng 5251, vì code đã implement trước đó luôn dùng tiền tố `meeting.minutes.*`; đi theo code đã có để nhất quán, không tạo permission trùng lặp).
- Role mặc định được cấp: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đồng nhất với các permission `minutes` khác — sở hữu permission không đồng nghĩa được sửa, xem 2.3).
- Sở hữu permission là điều kiện cần nhưng chưa đủ: service còn kiểm tra **resource ownership** theo rule ở mục 1.5 (SEC-02 của Constitution).

### 2.3 Actor Constraints
- Người không thỏa `userId === preparedBy OR userId === meeting.hostId` **không** được sửa, kể cả Business Admin/System Admin, kể cả Participant/Organizer thường.
- Nếu biên bản không còn `draft` (đã `published`/`archived`), mọi request update đều bị từ chối — kể cả với đúng người có quyền.

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous)
- **FR-001**: THE system SHALL cho phép cập nhật độc lập từng field trong tập `{title, minutesContent, decisionsJson, actionItemsJson}` của một `meeting_minutes` đang `status = draft` (partial update).
- **FR-002**: THE system SHALL giữ nguyên `status = draft` sau khi update thành công (không tự chuyển sang `published`/`archived`), đúng POST-2 của UC gốc.
- **FR-003**: THE system SHALL tăng `versionNo += 1` cho mỗi lần update thành công.
- **FR-004**: THE system SHALL KHÔNG cho phép request body ghi đè `visibilityLevel`, `attendeesSnapshotJson`, `status`, `preparedBy`, `issuedBy/issuedAt`, `approvedBy/approvedAt`, `fileId`, `linkedTranscriptId`, `linkedRecordingFileId` — DTO không nhận các field này làm input.

### 3.2 Event-driven Requirements
- **FR-005**: WHEN người dùng gửi `PATCH /api/v1/meeting-minutes/:id` với ít nhất 1 field hợp lệ trong `{title, minutesContent, decisionsJson, actionItemsJson}`, THE system SHALL kiểm tra tuần tự trong 1 transaction: (1) biên bản tồn tại và chưa xóa mềm, (2) người gọi thỏa ownership rule (mục 2.3), (3) biên bản đang `draft`, (4) `versionNo` trong request khớp `versionNo` hiện tại trong DB, trước khi ghi.
- **FR-006**: WHEN update thành công AND `meeting.status = completed` tại thời điểm update, THE system SHALL re-tính `attendeesSnapshotJson` từ `meeting_participants` mới nhất (ghi đè snapshot cũ) trong cùng transaction.
- **FR-007**: WHEN update thành công AND `meeting.status != completed` (vẫn `in_progress`), THE system SHALL giữ nguyên `attendeesSnapshotJson` hiện có, không refresh.
- **FR-008**: WHEN không có field nào trong `{title, minutesContent, decisionsJson, actionItemsJson}` được gửi trong request body, THE system SHALL từ chối với `400 VALIDATION_ERROR` (code chi tiết `NO_UPDATE_FIELD`) trước khi mở transaction.

### 3.3 State-driven Requirements
- **FR-009**: WHILE `meeting_minutes.status != draft`, THE system SHALL từ chối mọi request update (kể cả từ đúng người có quyền), trả `409 MINUTES_NOT_DRAFT`.
- **FR-010**: WHILE request `versionNo` khác `meeting_minutes.versionNo` hiện tại trong DB, THE system SHALL từ chối với `409 MINUTES_VERSION_CONFLICT`, kèm dữ liệu mới nhất trong `details` (xem mục 6.4) để FE tự quyết định reload hay ghi đè lại.

### 3.4 Optional Feature Requirements
- **FR-011**: WHERE request có `actionItemsJson` chứa phần tử không có `id`, THE system SHALL tự sinh `id` (UUID) cho phần tử đó trước khi lưu.
- **FR-012**: WHERE request có `actionItemsJson` chứa phần tử có `id` đã tồn tại trong bản ghi cũ, THE system SHALL giữ nguyên `id` đó (cho phép FE gửi lại toàn bộ mảng đã chỉnh sửa mà không làm mất liên kết `id` của các item cũ).

### 3.5 Unwanted Behavior Requirements
- **FR-013**: IF biên bản không tồn tại hoặc đã xóa mềm, THEN THE system SHALL trả `404 MINUTES_NOT_FOUND`.
- **FR-014**: IF người gọi không thỏa ownership rule (mục 2.3), THEN THE system SHALL trả `403 NOT_MINUTES_OWNER`, không tiết lộ nội dung biên bản trong response lỗi.
- **FR-015**: IF `minutesContent` vượt quá 20000 ký tự, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-016**: IF `title` vượt quá 255 ký tự, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-017**: IF `decisionsJson` hoặc `actionItemsJson` có nhiều hơn 100 phần tử, THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-018**: IF phần tử trong `decisionsJson` thiếu `decision` (rỗng/không phải string), THEN THE system SHALL trả `400 VALIDATION_ERROR`.
- **FR-019**: IF phần tử trong `actionItemsJson` thiếu `title` (rỗng/không phải string), THEN THE system SHALL trả `400 VALIDATION_ERROR`.

### 3.6 Workflow Requirements
- **FR-020**: THE system SHALL khóa hàng (`pessimistic_write`) trên `meeting_minutes` khi bắt đầu transaction update, để đảm bảo kiểm tra `versionNo` và ghi dữ liệu là atomic (tránh 2 request cùng pass version-check rồi cùng ghi).
- **FR-021**: THE system SHALL thực hiện toàn bộ việc đọc + kiểm tra + ghi `meeting_minutes` (và refresh `attendeesSnapshotJson` nếu áp dụng) trong một transaction duy nhất cùng với việc ghi audit log, đảm bảo tính nhất quán (ARCH constraint chung của dự án).

### 3.7 Data & State Requirements
- **FR-022**: THE system SHALL không thêm cột mới vào bảng `meeting_minutes` (đã có sẵn `title`, `minutes_content`, `decisions_json`, `action_items_json`, `version_no` trong baseline DB v3.2 Compact).
- **FR-023**: `meeting_minutes.updated_at` SHALL tự động cập nhật qua `@UpdateDateColumn` của TypeORM khi save (không cần set thủ công).

### 3.8 Notification / Audit Requirements
- **FR-024**: THE system SHALL ghi 1 bản ghi `audit_logs` (action_type = `meeting_minutes_updated`, entity_type = `meeting_minutes`) khi update thành công, dùng `AuditLogsService.logEntityChange` với `oldValueJson`/`newValueJson` chỉ chứa `{versionNo, updatedFields}` (KHÔNG lưu toàn văn `minutesContent` cũ/mới vào audit để tránh log quá nặng).
- **FR-025**: THE system SHALL NOT gửi notification cho participants khi cập nhật biên bản nháp (biên bản draft chỉ người có quyền sửa nhìn thấy, nhất quán FR-019 của UC-MKM-01 và FR-020 của `feat-attach-minutes-document`).

### 3.9 Complex / Combined Requirements
- **FR-026**: IF `minutes.status = draft` AND người gọi thỏa ownership rule AND `versionNo` khớp AND có ít nhất 1 field hợp lệ, THEN THE system SHALL cập nhật các field được gửi, tăng `versionNo`, refresh `attendeesSnapshotJson` nếu `meeting.status = completed`, ghi audit log, và trả về bản ghi đã cập nhật đầy đủ trong 1 lần gọi.

### 3.10 Traceability
| FR ID | Nguồn gốc |
| :--- | :--- |
| FR-001, FR-008 | Normal Flow bước 4-5 của UC-MKM-04 gốc + Q&A "partial update" (mục 1.5) |
| FR-002 | POST-2 của UC-MKM-04 gốc |
| FR-003, FR-010, FR-020 | Q&A "concurrency" (mục 1.5) |
| FR-004 | BR1/BR2 của UC-MKM-04 gốc (chỉ nội dung nháp; không đụng workflow ban hành) |
| FR-006, FR-007 | Q&A "refresh attendees snapshot" (mục 1.5), kế thừa gợi ý ở UC-MKM-01 mục 1.4 |
| FR-009 | BR1 của UC-MKM-04 gốc |
| FR-011, FR-012 | Q&A "schema action_items_json" (mục 1.5) |
| FR-014 | BR2 của UC-MKM-04 gốc + Q&A "ai được sửa" (mục 1.5) |
| FR-024, FR-025 | Gap analysis (Exceptions/Audit ghi N/A trong UC gốc) |

## 4. Non-functional Requirements

### 4.1 Performance
- API phải phản hồi trong < 500ms ở điều kiện bình thường (1 lock + 1 update + tối đa 1 lần đọc lại `meeting_participants` khi refresh snapshot).

### 4.2 Security
- Endpoint yêu cầu JWT hợp lệ (SEC-02) và permission `meeting.minutes.update`.
- Input validation strict (`whitelist: true, forbidNonWhitelisted: true`) theo SEC-03.
- Ownership check (mục 2.3) enforce ở tầng service, không tin tưởng bất kỳ tham số phân quyền nào từ client.

### 4.3 Reliability & Consistency
- Optimistic locking qua `versionNo` (FR-003, FR-010) chống mất dữ liệu khi có nhiều phiên chỉnh sửa gần như đồng thời.
- Idempotency: gọi lại PATCH với cùng `versionNo` đã bị dùng (do request trước đã thành công) sẽ luôn trả `409 MINUTES_VERSION_CONFLICT` thay vì âm thầm ghi đè (ARCH-03).

### 4.4 Usability
- Response trả về đầy đủ dữ liệu đã cập nhật (bao gồm `versionNo` mới) để FE cập nhật UI ngay mà không cần gọi thêm API xem chi tiết.
- Khi `409 MINUTES_VERSION_CONFLICT`, response trả kèm dữ liệu mới nhất trong `error.details` để FE có thể hiển thị diff hoặc tự động reload form.

### 4.5 Observability
- Log đủ thông tin để debug: `minutesId`, `userId`, field nào được cập nhật, kết quả (success/lỗi + code).

### 4.6 Maintainability
- Business logic đặt trong `MinutesService` (method `updateDraft`), tái sử dụng helper ownership-check hiện có nếu phù hợp (xem `loadMinutesForOwnerCheck` trong `feat-attach-minutes-document` — cần mở rộng logic vì ownership rule ở đây rộng hơn, gồm cả `meeting.hostId`).

## 5. Data Model

### 5.1 Entity liên quan
- `MeetingMinutesEntity` (bảng `meeting_minutes`) — đọc + lock + ghi (`title`, `minutesContent`, `decisionsJson`, `actionItemsJson`, `attendeesSnapshotJson` có điều kiện, `versionNo`).
- `MeetingEntity` (bảng `meetings`) — đọc để lấy `hostId`/`status`, không ghi.
- `MeetingParticipantEntity` (bảng `meeting_participants`) — đọc để refresh snapshot khi `meeting.status = completed`, không ghi.
- `AuditLogEntity` (bảng `audit_logs`) — ghi 1 dòng audit qua `AuditLogsService.logEntityChange`.

### 5.2 Dữ liệu đầu vào (Request Body)
```jsonc
// PATCH /api/v1/meeting-minutes/:id
{
  "versionNo": 1,                    // bắt buộc — version đang sửa, dùng cho optimistic lock
  "title": "string, optional, max 255",
  "minutesContent": "string, optional, max 20000",
  "decisionsJson": [                 // optional, max 100 phần tử
    {
      "decision": "string, required, max 500",
      "responsibleUserId": "uuid | null, optional"
    }
  ],
  "actionItemsJson": [               // optional, max 100 phần tử
    {
      "id": "uuid, optional — server tự sinh nếu thiếu (FR-011)",
      "title": "string, required, max 255",
      "assigneeUserId": "uuid | null, optional",
      "dueDate": "ISO date string | null, optional",
      "priority": "low | medium | high, optional, mặc định medium"
    }
  ]
}
```
Path param: `id` (UUID, bắt buộc — id của `meeting_minutes`).
Ràng buộc: phải có ít nhất 1 trong 4 field `title/minutesContent/decisionsJson/actionItemsJson` (FR-008).

### 5.3 Dữ liệu đầu ra (Response 200)
```jsonc
{
  "success": true,
  "message": "Cap nhat noi dung bien ban cuoc hop thanh cong",
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "title": "string",
    "status": "draft",
    "versionNo": 2,                  // đã +1
    "minutesContent": "string",
    "decisionsJson": [ /* như 5.2 */ ],
    "actionItemsJson": [ /* như 5.2, mỗi item có id */ ],
    "attendeesSnapshotJson": [ /* refresh nếu meeting completed, giữ nguyên nếu không */ ],
    "preparedBy": "uuid",
    "updatedAt": "ISO datetime"
  }
}
```

### 5.4 State / Status Model
`meeting_minutes.status` không đổi trong feature này — luôn giữ `draft` (xem FR-002). Transition `draft → published` thuộc feature "ban hành" (`feat-issue-meeting-minutes`, chưa tồn tại, ngoài phạm vi).

### 5.5 Data Constraints
- `versionNo` request phải khớp chính xác `versionNo` hiện tại trong DB (không hỗ trợ merge tự động 2 bản chỉnh sửa khác nhau).
- Giới hạn độ dài/số lượng: xem FR-015 → FR-019.

### 5.6 Data Lifecycle
Tạo (UC-MKM-01) → **Chỉnh sửa nội dung nhiều lần (feature này, mỗi lần `versionNo += 1`)** → Đính kèm/gỡ tài liệu (song song, `feat-attach-minutes-document`) → Ban hành (`feat-issue-meeting-minutes`, ngoài phạm vi) → Lưu trữ/Xóa mềm.

### 5.7 Data-related EARS Requirements
Xem FR-001, FR-003, FR-004, FR-006, FR-011, FR-022.

## 6. Error Handling

### 6.1 Validation Errors
- Không có field nào trong `{title, minutesContent, decisionsJson, actionItemsJson}` → `400 VALIDATION_ERROR` (`NO_UPDATE_FIELD`).
- `title` > 255 ký tự → `400 VALIDATION_ERROR`.
- `minutesContent` > 20000 ký tự → `400 VALIDATION_ERROR`.
- `decisionsJson`/`actionItemsJson` > 100 phần tử → `400 VALIDATION_ERROR`.
- Phần tử `decisionsJson` thiếu `decision` hoặc `actionItemsJson` thiếu `title` → `400 VALIDATION_ERROR`.
- `versionNo` thiếu hoặc không phải số nguyên → `400 VALIDATION_ERROR`.
- `id` (path param) không phải UUID hợp lệ → `400` (`ParseUUIDPipe`).

### 6.2 Authentication / Authorization Errors
- Không có JWT hợp lệ → `401`.
- Không có permission `meeting.minutes.update` → `403 FORBIDDEN`.
- Có permission nhưng không thỏa ownership rule (mục 2.3) → `403 NOT_MINUTES_OWNER`.

### 6.3 Business Rule Errors
- Biên bản không tồn tại/đã xóa mềm → `404 MINUTES_NOT_FOUND`.
- Biên bản không ở trạng thái `draft` → `409 MINUTES_NOT_DRAFT`.

### 6.4 Conflict Errors
- `versionNo` request khác `versionNo` hiện tại trong DB → `409 MINUTES_VERSION_CONFLICT`, `error.details` gồm:
```jsonc
{
  "currentVersionNo": 3,
  "currentData": {
    "title": "string",
    "minutesContent": "string",
    "decisionsJson": [],
    "actionItemsJson": [],
    "updatedAt": "ISO datetime"
  }
}
```

### 6.5 Integration / External Service Errors
Không có (feature này không gọi external service).

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
- **AC-001**: GIVEN biên bản `M` có `status=draft`, `preparedBy=U`, `versionNo=1`, WHEN `U` gọi PATCH với `versionNo=1` và `minutesContent` mới, THEN trả `200`, `versionNo=2`, `minutesContent` đã đổi, `status` vẫn `draft`.
- **AC-002**: GIVEN biên bản `M` có `preparedBy=A` nhưng `meeting.hostId=B` (host đã đổi sau khi A tạo), WHEN `B` gọi PATCH đúng `versionNo`, THEN trả `200` (B được phép sửa vì là host hiện tại).
- **AC-003**: GIVEN `meeting.status=completed` tại thời điểm update, WHEN `U` gọi PATCH thành công, THEN `attendeesSnapshotJson` trong response phản ánh dữ liệu `meeting_participants` mới nhất (không còn `not_checked_in` nếu đã cập nhật điểm danh sau đó).
- **AC-004**: GIVEN request chỉ gửi `title` (không gửi `minutesContent`/`decisionsJson`/`actionItemsJson`), WHEN update thành công, THEN các field không gửi giữ nguyên giá trị cũ trong response.
- **AC-005**: GIVEN `actionItemsJson` gửi lên có 1 phần tử không có `id`, WHEN update thành công, THEN phần tử đó có `id` (UUID) được server tự sinh trong response.

### 7.2 Authorization Cases
- **AC-006**: GIVEN người gọi không phải `preparedBy` và không phải `meeting.hostId` hiện tại (kể cả Participant/Organizer), WHEN gọi PATCH, THEN trả `403 NOT_MINUTES_OWNER`.
- **AC-007**: GIVEN người gọi là Business Admin/System Admin (có permission `meeting.minutes.update` nhưng không phải preparedBy/host), WHEN gọi PATCH, THEN trả `403 NOT_MINUTES_OWNER` (Admin KHÔNG được bypass — xem mục 1.5).
- **AC-008**: GIVEN người gọi không có permission `meeting.minutes.update`, WHEN gọi PATCH, THEN trả `403 FORBIDDEN`.

### 7.3 Business Rule Cases
- **AC-009**: GIVEN biên bản `M` có `status=published`, WHEN `preparedBy` gọi PATCH, THEN trả `409 MINUTES_NOT_DRAFT`.
- **AC-010**: GIVEN request không có field nào trong `{title, minutesContent, decisionsJson, actionItemsJson}`, WHEN gọi PATCH, THEN trả `400 VALIDATION_ERROR` (`NO_UPDATE_FIELD`).

### 7.4 Validation Cases
- **AC-011**: GIVEN `minutesContent` dài 20001 ký tự, WHEN gọi PATCH, THEN trả `400 VALIDATION_ERROR`.
- **AC-012**: GIVEN `actionItemsJson` có phần tử thiếu `title`, WHEN gọi PATCH, THEN trả `400 VALIDATION_ERROR`.
- **AC-013**: GIVEN request thiếu `versionNo`, WHEN gọi PATCH, THEN trả `400 VALIDATION_ERROR`.

### 7.5 State Transition / Concurrency Cases
- **AC-014**: GIVEN biên bản `M` có `versionNo=2` trong DB, WHEN `U` gọi PATCH với `versionNo=1` (đã cũ), THEN trả `409 MINUTES_VERSION_CONFLICT` kèm `currentVersionNo=2` và `currentData` mới nhất.
- **AC-015**: GIVEN 2 request PATCH gửi gần như đồng thời cho cùng `M` với cùng `versionNo=1` (race condition), WHEN cả 2 gần như đồng thời, THEN chỉ 1 request thành công (`200`, `versionNo=2`), request còn lại nhận `409 MINUTES_VERSION_CONFLICT` (đảm bảo bằng lock `pessimistic_write`, xem FR-020).

### 7.6 Notification / Audit Cases
- **AC-016**: GIVEN update thành công, THEN có đúng 1 bản ghi `audit_logs` mới với `action_type=meeting_minutes_updated`.
- **AC-017**: GIVEN update thành công, THEN KHÔNG có notification nào được tạo/queue.

### 7.7 Acceptance Criteria Traceability
| AC ID | FR liên quan |
| :--- | :--- |
| AC-001, AC-004 | FR-001, FR-002, FR-003 |
| AC-002 | FR-014 (ownership rule mở rộng, mục 1.5/2.3) |
| AC-003 | FR-006, FR-007 |
| AC-005 | FR-011 |
| AC-006, AC-007 | FR-014 |
| AC-008 | Permission guard (mục 2.2) |
| AC-009 | FR-009 |
| AC-010 | FR-008 |
| AC-011, AC-012, AC-013 | FR-015..FR-019 |
| AC-014, AC-015 | FR-010, FR-020 |
| AC-016, AC-017 | FR-024, FR-025 |

## 8. Out of Scope

### 8.1 Không triển khai trong feature này
- Đính kèm/gỡ tài liệu (đã có `feat-attach-minutes-document`).
- Cập nhật `visibilityLevel` (thuộc UC-136, `feat-update-minutes-visibility`, chưa tồn tại).
- Ban hành chính thức biên bản (`feat-issue-meeting-minutes`, chưa tồn tại).
- Xóa biên bản họp (`feat-delete-meeting-minutes`, chưa tồn tại).
- Autosave định kỳ (chỉ save thủ công khi FE gọi API — xem mục 1.5).
- Đánh dấu hoàn thành từng action item riêng lẻ (`actionItemsJson[].status`) — feature này chỉ lưu nội dung/assignee/deadline/priority, không có khái niệm trạng thái hoàn thành trong phạm vi này.
- Validate `assigneeUserId`/`responsibleUserId` phải là participant của cuộc họp — chấp nhận bất kỳ `userId` hợp lệ trong hệ thống (không ràng buộc theo danh sách tham dự).
- Cập nhật lại `permissions.canEdit` của `feat-view-meeting-minutes-detail` (UC-MKM-03) cho khớp ownership rule mới — cần một thay đổi riêng trên spec đó, ngoài phạm vi worktree hiện tại (xem mục 1.5).

### 8.2 Có thể xem xét ở feature khác
- `feat-update-minutes-visibility` (UC-136).
- `feat-issue-meeting-minutes` (ban hành).
- `feat-delete-meeting-minutes` (xóa mềm).
- Đồng bộ lại `feat-view-meeting-minutes-detail` để sửa công thức `canEdit`.

### 8.3 Out-of-scope EARS Guardrails
- **FR-OOS-001**: THE system SHALL NOT nhận `visibilityLevel` làm input của endpoint này.
- **FR-OOS-002**: THE system SHALL NOT thay đổi `status` của `meeting_minutes` trong phạm vi feature này.
- **FR-OOS-003**: THE system SHALL NOT cho phép Business Admin/System Admin cập nhật biên bản khi họ không phải `preparedBy` hoặc `meeting.hostId`.
- **FR-OOS-004**: THE system SHALL NOT xử lý file đính kèm (upload/list/delete) trong endpoint PATCH này.

## Assumptions
Xem mục 1.4 và 1.5.
