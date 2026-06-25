# Feature Specification: Xem ghi chú trong cuộc họp (View Meeting Notes)

- **Feature ID**: UC-IMM-10
- **Feature Name**: Xem ghi chú trong cuộc họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-18
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables) — bảng `meeting_notes`, `meetings`, `meeting_participants`, `meeting_events`
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-102, UC-103, UC-104)
  - feat-in-meeting-notes/spec.md (UC-IMM-09) — đồng bộ convention create/list notes, visibility rules
  - feat-request-meeting-extension/spec.md (UC-IMM-02) — đồng bộ Meeting Dashboard context, authorization pattern

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Bổ sung Clarification Decisions CD-001/CD-002/CD-003: opt-in `includeSourceEvent`, đổi `createdAt` → `noteTimestamp`, no admin bypass, `INVALID_DATE_RANGE` error code, `from`/`to` độc lập | §1.4, BR-010/013/016, FR-014/017/021, §5, §11, §13, §14, AC/EC liên quan |
| 2026-06-18 | Tạo spec.md lần đầu cho UC-IMM-10 Xem ghi chú trong cuộc họp — read-only, visibility rules, pagination, filter, empty state | Toàn bộ file |

---

## EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh.

| Keyword | Vai trò |
|---|---|
| THE system SHALL | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| WHEN | Trigger/event xảy ra tại một thời điểm |
| WHILE | Hành vi đúng trong suốt một trạng thái |
| WHERE | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| IF ... THEN | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-10 thuộc nhóm In-Meeting Management, module `live-meeting`.

Trong quy trình meeting lifecycle, sau khi ghi chú được tạo (UC-IMM-09 / UC-102), người dùng cần khả năng xem lại danh sách các ghi chú có timestamp theo timeline, lọc nhanh theo loại ghi chú và truy xuất từ hai ngữ cảnh:

1. **Meeting Dashboard** (khi meeting ở trạng thái `in_progress`): Người dùng xem ghi chú trực tiếp trong phiên họp đang diễn ra — theo dõi quyết định, hành động cần làm, thông tin phát sinh.
2. **Meeting Detail** (khi meeting ở trạng thái `completed`): Người dùng review lại ghi chú sau khi họp kết thúc — tham chiếu cho minutes hoặc follow-up.

Feature này là **read-only hoàn toàn**: không tạo mới, không cập nhật, không xóa ghi chú. Không có side effect lên bất kỳ bảng nào.

Tính năng UC-IMM-10 xây dựng trên bối cảnh đã thống nhất từ UC-IMM-02 (Request Extension) và UC-IMM-09 (In-Meeting Notes create): meeting đang `in_progress` hoặc `completed`, actor đã được xác thực (JWT) và phải là Host hoặc Participant hợp lệ.

### 1.2 Mục tiêu

- Cho phép người dùng có quyền truy xuất danh sách ghi chú hợp lệ của meeting theo timeline tăng dần.
- Kiểm soát **nghiêm ngặt** khả năng đọc theo `visibility_level` và vai trò trong meeting:
  - **Host** thấy toàn bộ ghi chú hợp lệ (`deleted_at IS NULL`) của meeting, bao gồm cả private notes và host notes của mọi author.
  - **Participant** (non-Host) chỉ thấy ghi chú được chia sẻ cho participants/public và ghi chú của chính họ; tuyệt đối không thấy private notes của người khác.
- Hỗ trợ filter theo `noteType`, `visibility`, khoảng thời gian (`from`, `to`), ghim (`pinned`), sắp xếp.
- Hỗ trợ pagination đầy đủ (`page`, `limit`, `total`, `totalPages`).
- Trả empty state rõ ràng khi không có ghi chú phù hợp.
- Optional enrich timeline với timestamp từ `meeting_events` khi note có `source_event_id`.

### 1.3 Giả định

- Meeting ở trạng thái `in_progress` hoặc `completed`. Trạng thái `scheduled` không cho phép (chưa có ghi chú nào được tạo trong lúc họp).
- Actor đã đăng nhập, có JWT token hợp lệ và permission `meeting.note.read`.
- Host được xác định qua `meetings.host_id = currentUserId` hoặc `meeting_participants.participant_role = 'host'` với `meeting_participants.user_id = currentUserId`.
- External participant không thuộc scope — API hiện tại không hỗ trợ xác thực external.
- Ghi chú với `deleted_at IS NOT NULL` không bao giờ được trả về.
- Không có cột `tag` riêng trong `meeting_notes`. Filter theo tag dùng `note_type` làm proxy ở phase hiện tại; tag phân loại chi tiết là Future Enhancement.
- Content ghi chú đã được sanitize XSS khi tạo (UC-102 / NFR-005) — không cần sanitize lại khi đọc.

### 1.4 Clarification Decisions (đã giải quyết)

**CD-001 — Source Event Enrichment**: API không `LEFT JOIN meeting_events` mặc định. Timestamp chính của note là `meeting_notes.created_at` và được trả về dưới field `noteTimestamp`. Client có thể truyền `includeSourceEvent=true` nếu cần enrich timeline context từ `meeting_events` thông qua `meeting_notes.source_event_id`. Khi enrich, response bổ sung `sourceEventTime` và `sourceEventType`, nhưng thứ tự mặc định của danh sách vẫn là `created_at ASC`.

**CD-002 — Admin / Manager Bypass**: UC-IMM-10 không cho phép System Admin, Business Admin, Manager hoặc user chỉ có permission `meeting.note.read` bypass membership để xem notes của meeting. Người gọi API bắt buộc phải là Host hoặc Participant hợp lệ của meeting. Nếu cần xem ghi chú để audit/giám sát, phải tạo use case riêng với permission riêng như `meeting.notes.audit.read`, không nằm trong scope của UC-IMM-10.

**CD-003 — Time Range Filter**: Query params `from` và `to` được phép gửi độc lập. Nếu chỉ có `from`, hệ thống lọc notes có `created_at >= from`. Nếu chỉ có `to`, hệ thống lọc notes có `created_at <= to`. Nếu có cả hai, hệ thống validate `from <= to`; nếu sai trả `400 INVALID_DATE_RANGE`.

---

## 2. Actor & Roles

### Primary Actor

- **Internal Employee trong vai trò Host**: Người chủ trì meeting. Có toàn quyền đọc tất cả ghi chú hợp lệ của meeting, bao gồm private notes và host notes của bất kỳ author nào. Permission cần: `meeting.note.read`.
- **Internal Employee trong vai trò Participant**: Người tham gia meeting nội bộ. Chỉ đọc được shared/public notes và ghi chú của chính họ. Permission cần: `meeting.note.read`.

### Secondary Actor

- **System**: Enrich timeline response nếu note có `source_event_id` (optional).

### Ngoài scope

- **External Participant**: Không có tài khoản trong hệ thống; API hiện tại không hỗ trợ xác thực external.
- Bất kỳ user nào không có permission `meeting.note.read`.
- Bất kỳ user nào không phải Host hoặc Participant hợp lệ của meeting — kể cả System Admin, Business Admin, Manager (BR-016, CD-002).
- **Audit/giám sát ghi chú ngoài membership**: Cần use case riêng với permission `meeting.notes.audit.read` — nằm ngoài scope UC-IMM-10.

---

## 3. Business Rules

BR-001: Meeting phải ở trạng thái `in_progress` hoặc `completed`; tất cả trạng thái khác (`draft`, `pending_approval`, `scheduled`, `cancelled`) bị từ chối.
BR-002: Actor phải là Host hoặc Participant hợp lệ của meeting — tồn tại trong `meeting_participants` với `user_id = currentUserId`, hoặc là `meetings.host_id`.
BR-003: Ghi chú với `deleted_at IS NOT NULL` không bao giờ được trả về trong response (soft delete filter bắt buộc).
BR-004: **Host** thấy tất cả ghi chú hợp lệ (`deleted_at IS NULL`) của meeting — bao gồm `visibility_level = 'private'` của bất kỳ author nào, bao gồm `note_type = 'host_note'`, `note_type = 'system_note'`.
BR-005: **Participant** (non-Host) chỉ thấy ghi chú thỏa một trong các điều kiện:
  - `author_id = currentUserId` (ghi chú của chính mình, bất kể `visibility_level`).
  - `visibility_level = 'participants'` (chia sẻ với toàn bộ participant của meeting).
  - `visibility_level = 'public_internal'` (chia sẻ với toàn bộ internal user đã xác thực).
  - `visibility_level = 'department'` (cùng `department_id` với `author`).
BR-006: Private notes của Host — `note_type = 'host_note'` với `visibility_level = 'private'` hoặc bất kỳ note nào có `visibility_level = 'private'` mà `author_id != currentUserId` — **tuyệt đối không được trả về** trong response của Participant. Quy tắc này không có ngoại lệ.
BR-007: Danh sách ghi chú sắp xếp mặc định theo `created_at ASC` (timeline tăng dần).
BR-008: `sort=timeline_desc` đảo ngược thứ tự thành `created_at DESC`. Chỉ hỗ trợ `timeline_asc` và `timeline_desc` trong v1.
BR-009: Không có cột `tag` trong schema hiện tại. Filter theo tag thực hiện qua `noteType` trong v1. Không thêm cột mới.
BR-010: Enrichment timeline từ `meeting_events` là **opt-in**: chỉ thực hiện khi client truyền query param `includeSourceEvent=true` (CD-001). Khi opt-in và note có `source_event_id IS NOT NULL`, hệ thống `LEFT JOIN meeting_events` để lấy `sourceEventTime` (`event_time`) và `sourceEventType` (`event_type`). Khi `includeSourceEvent` không có hoặc là `false`, không thực hiện JOIN `meeting_events`. Nếu record `meeting_events` không còn tồn tại khi đã opt-in, `sourceEventTime = null` và `sourceEventType = null`.
BR-011: Đây là **read-only** operation: không INSERT, không UPDATE, không DELETE bất kỳ bảng nào.
BR-012: Empty state khi không có ghi chú phù hợp: trả HTTP 200, `data = []`, `meta.total = 0`, `message = "Cuộc họp này không có ghi chú nào được lưu lại."`.
BR-013: Filter `from` và `to` áp dụng trên `meeting_notes.created_at` (timestamptz); `from` inclusive, `to` inclusive. `from` và `to` **được phép gửi độc lập** (CD-003): chỉ `from` → lọc `created_at >= from`; chỉ `to` → lọc `created_at <= to`; cả hai → validate `from <= to` trước khi thực hiện query.
BR-014: Pagination: default `page = 1`, default `limit = 20`, max `limit = 100`.
BR-015: Filter `visibility` từ query param áp dụng SAU role-based visibility enforcement (BR-004, BR-005). Participant không thể dùng `?visibility=private` để đọc private notes của người khác.
BR-016: System Admin, Business Admin, Manager hoặc user chỉ có permission `meeting.note.read` **không** được phép bypass membership để xem ghi chú của meeting (CD-002). Người gọi bắt buộc phải là Host hoặc Participant hợp lệ. Nếu cần audit/giám sát ghi chú ngoài membership, cần use case riêng với permission `meeting.notes.audit.read` — nằm ngoài scope UC-IMM-10.

---

## 4. Functional Requirements

FR-001: THE system SHALL require valid JWT authentication for all requests to this endpoint.
FR-002: THE system SHALL validate actor has permission `meeting.note.read`; IF not, THEN return 403 `PERMISSION_DENIED`.
FR-003: THE system SHALL validate `meetingId` is a valid UUID format; IF invalid, THEN return 400 `VALIDATION_ERROR`.
FR-004: THE system SHALL validate meeting exists and `deleted_at IS NULL`; IF not found, THEN return 404 `MEETING_NOT_FOUND`.
FR-005: THE system SHALL validate meeting `status` is `in_progress` or `completed`; IF other status, THEN return 422 `MEETING_STATUS_NOT_VIEWABLE`.
FR-006: THE system SHALL validate actor is Host or valid Participant of the meeting (BR-002); IF not, THEN return 403 `NOT_A_MEETING_PARTICIPANT`.
FR-007: WHEN actor is Host, THE system SHALL return all notes where `meeting_id = :meetingId AND deleted_at IS NULL` (BR-004) — without any `visibility_level` restriction.
FR-008: WHEN actor is Participant (non-Host), THE system SHALL apply strict visibility filter per BR-005 and BR-006 before returning results.
FR-009: THE system SHALL exclude all notes where `deleted_at IS NOT NULL` from every response path (BR-003).
FR-010: THE system SHALL sort results by `created_at ASC` by default; IF `sort=timeline_desc`, THEN sort by `created_at DESC` (BR-007, BR-008).
FR-011: THE system SHALL support optional filter by `noteType`; IF provided, validate value is in allowlist `['in_meeting', 'private', 'host_note', 'system_note']`; IF invalid, THEN return 400.
FR-012: THE system SHALL support optional filter by `visibility`; IF provided, validate value is in allowlist `['private', 'participants', 'public_internal', 'department']`; IF invalid, THEN return 400. This filter is applied AFTER role-based filter (BR-015).
FR-013: THE system SHALL support optional filter by `pinned` (boolean).
FR-014: THE system SHALL support optional independent date range filter: `from` and `to` on `meeting_notes.created_at` (BR-013, CD-003); `from` and `to` MAY be sent independently; IF provided, validate ISO datetime format (error: `VALIDATION_ERROR`); IF both provided AND `from > to`, THEN return 400 `INVALID_DATE_RANGE`.
FR-015: THE system SHALL support pagination via `page` (default 1, min 1) and `limit` (default 20, min 1, max 100) query params (BR-014); IF `limit > 100`, THEN return 400.
FR-016: THE system SHALL return pagination metadata: `page`, `limit`, `total`, `totalPages`.
FR-017: THE system SHALL NOT perform `LEFT JOIN meeting_events` by default (CD-001). WHEN client passes `includeSourceEvent=true` AND note has `source_event_id IS NOT NULL`, THE system SHALL enrich response with `sourceEventTime` (from `meeting_events.event_time`) and `sourceEventType` (from `meeting_events.event_type`); IF `meeting_events` record not found, THEN `sourceEventTime = null` and `sourceEventType = null` (BR-010).
FR-018: IF no notes match after all filters and visibility rules, THE system SHALL return HTTP 200 with `data = []` and message `"Cuộc họp này không có ghi chú nào được lưu lại."` (BR-012).
FR-019: THE system SHALL include author information in each note item: `author.id` and `author.fullName` (joined from `users`).
FR-020: THE system SHALL NOT write to any database table during this operation (BR-011).
FR-021: THE system SHALL return the primary note timestamp under the field name `noteTimestamp` (mapped from `meeting_notes.created_at`) in every response item (CD-001).

---

## 5. Key Entities

### 5.1 Bảng chính: `meeting_notes`

| Column | Type | Vai trò trong UC-IMM-10 |
|---|---|---|
| `id` | `uuid PK` | Khóa chính trả về trong response |
| `meeting_id` | `uuid FK → meetings.id` | Filter ghi chú theo meeting (required) |
| `author_id` | `uuid FK → users.id` | Xác định quyền sở hữu; visibility rule cho Participant |
| `note_type` | `varchar(30)` | Filter tùy chọn: `in_meeting` / `private` / `host_note` / `system_note` |
| `content` | `text NOT NULL` | Nội dung ghi chú (đã sanitize từ UC-102) |
| `pinned` | `boolean DEFAULT false` | Filter tùy chọn theo ghim |
| `visibility_level` | `varchar(30) DEFAULT 'participants'` | Quy tắc visibility cốt lõi — phân quyền đọc theo BR-004/BR-005 |
| `source_event_id` | `uuid FK → meeting_events.id` | Enrich timeline optional (FR-017) |
| `created_at` | `timestamptz` | Sắp xếp timeline (FR-010); filter `from`/`to` (FR-014) |
| `updated_at` | `timestamptz` | Thông tin cập nhật cuối, trả trong response |
| `deleted_at` | `timestamptz` | Luôn lọc `IS NULL` (BR-003, FR-009) |

### 5.2 Bảng validate/join

| Bảng | Cột sử dụng | Mục đích |
|---|---|---|
| `meetings` | `id`, `status`, `host_id`, `deleted_at` | Validate tồn tại, status hợp lệ, xác định host (FR-004, FR-005, FR-006) |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Validate quyền xem; xác định Host/Participant (FR-006, BR-002) |
| `users` | `id`, `full_name`, `department_id` | Join author info cho response (FR-019); xác định cùng phòng ban (BR-005 visibility `department`) |
| `meeting_events` | `id`, `event_time` | Optional enrich `sourceEventTime` khi note có `source_event_id` (FR-017) |

### 5.3 Index phụ thuộc (không thay đổi schema)

- `ix_meeting_notes_meeting ON meeting_notes(meeting_id)` — filter theo `meeting_id`.
- `ix_meeting_notes_type ON meeting_notes(note_type)` — filter `noteType`.
- GIN index `ix_meeting_notes_content_fts` — được tạo bởi UC-102 migration (nếu available), hỗ trợ UC-104 full-text search nếu kết hợp sau.

---

## 6. User Scenarios & Testing

### Scenario 1 — Host xem notes khi họp đang diễn ra

**Actor**: Host của meeting
**Precondition**: Meeting đang `in_progress`; đã có notes bao gồm `in_meeting`, `private` (của một participant), `host_note` (của Host)
**Action**: `GET /api/v1/meetings/{meetingId}/notes`
**Expected**: 200, tất cả notes hợp lệ được trả về bao gồm private note của participant và host_note của Host; sorted `created_at ASC`

### Scenario 2 — Participant xem notes khi họp đang diễn ra

**Actor**: Participant (non-Host)
**Precondition**: Meeting đang `in_progress`; đã có notes bao gồm `in_meeting` (visibility `participants`), `host_note` (Host's private), `private` (Participant's own)
**Action**: `GET /api/v1/meetings/{meetingId}/notes`
**Expected**: 200, chỉ trả `in_meeting` + Participant's own `private`; KHÔNG trả `host_note` của Host

### Scenario 3 — Host xem notes sau khi họp kết thúc

**Actor**: Host
**Precondition**: Meeting đã `completed`
**Action**: `GET /api/v1/meetings/{meetingId}/notes`
**Expected**: 200, toàn bộ notes hợp lệ

### Scenario 4 — Filter theo loại và khoảng thời gian

**Actor**: Participant
**Action**: `GET /api/v1/meetings/{meetingId}/notes?noteType=in_meeting&from=2026-06-18T09:00:00Z&to=2026-06-18T11:00:00Z`
**Expected**: 200, chỉ ghi chú `in_meeting` trong khoảng thời gian, phù hợp visibility Participant

### Scenario 5 — Meeting không có ghi chú

**Actor**: Host hoặc Participant
**Action**: `GET /api/v1/meetings/{meetingId}/notes`
**Expected**: 200, `data = []`, `meta.total = 0`, `message = "Cuộc họp này không có ghi chú nào được lưu lại."`

### Scenario 6 — Người dùng không phải participant

**Actor**: Internal user không có trong meeting này
**Action**: `GET /api/v1/meetings/{meetingId}/notes`
**Expected**: 403 `NOT_A_MEETING_PARTICIPANT`

### Scenario 7 — Meeting chưa bắt đầu

**Actor**: Host
**Action**: `GET /api/v1/meetings/{meetingId}/notes` khi meeting đang `scheduled`
**Expected**: 422 `MEETING_STATUS_NOT_VIEWABLE`

---

## 7. Acceptance Criteria

**Primary flow — Host xem toàn bộ:**

AC-001: Host gọi GET notes khi meeting `in_progress` → response 200, tất cả ghi chú hợp lệ của meeting được trả, kể cả `private` của bất kỳ author nào, sorted `created_at ASC`.
AC-002: Host gọi GET notes khi meeting `completed` → response 200, tất cả ghi chú hợp lệ của meeting.
AC-003: Response không chứa bất kỳ note nào có `deleted_at IS NOT NULL`.
AC-004: Mỗi note item có đầy đủ `author.id` và `author.fullName`.

**Primary flow — Participant visibility filter:**

AC-005: Participant (non-Host) gọi GET notes → response 200, chỉ trả:
  - Ghi chú của chính Participant (`author_id = participantUserId`).
  - Ghi chú có `visibility_level = 'participants'`.
  - Ghi chú có `visibility_level = 'public_internal'`.
  - Ghi chú có `visibility_level = 'department'` khi cùng phòng ban với author.
AC-006: Ghi chú có `visibility_level = 'private'` và `author_id != participantUserId` KHÔNG xuất hiện trong response của Participant — dù filter query có hoặc không có.
AC-007: `note_type = 'host_note'` với `visibility_level = 'private'` KHÔNG xuất hiện trong response của Participant.

**Filter:**

AC-008: GET `?noteType=in_meeting` → chỉ trả ghi chú loại `in_meeting`, sau khi áp visibility filter theo role.
AC-009: GET `?pinned=true` → chỉ trả ghi chú có `pinned = true`, sau khi áp visibility filter.
AC-010: GET `?from=2026-06-18T08:00:00Z&to=2026-06-18T10:00:00Z` → chỉ trả ghi chú có `created_at` trong khoảng, sau khi áp visibility filter. Chỉ `?from=...` (không có `to`) hoặc chỉ `?to=...` (không có `from`) đều hợp lệ và hoạt động độc lập (CD-003).
AC-011: GET `?visibility=participants` áp SAU role filter — Participant dùng filter này không thể xem private notes của người khác.

**Sort:**

AC-012: Mặc định (không truyền `sort`) → `created_at ASC`.
AC-013: `?sort=timeline_desc` → `created_at DESC`.

**Empty state:**

AC-014: Meeting không có ghi chú hợp lệ → HTTP 200, `data = []`, `meta.total = 0`, `message = "Cuộc họp này không có ghi chú nào được lưu lại."`.

**Pagination:**

AC-015: GET `?page=2&limit=5` → trả đúng 5 ghi chú trang 2 (nếu có), `meta.page = 2`, `meta.limit = 5`.
AC-016: `meta.totalPages = ceil(meta.total / meta.limit)`.

**Error cases:**

AC-017: Chưa đăng nhập → 401 `UNAUTHORIZED`.
AC-018: Thiếu permission `meeting.note.read` → 403 `PERMISSION_DENIED`.
AC-019: User không phải Host hay Participant → 403 `NOT_A_MEETING_PARTICIPANT`.
AC-020: `meetingId` không tồn tại → 404 `MEETING_NOT_FOUND`.
AC-021: Meeting ở trạng thái `draft`, `pending_approval`, `scheduled`, `cancelled` → 422 `MEETING_STATUS_NOT_VIEWABLE`.
AC-022: `from` không hợp lệ (không phải ISO datetime) → 400 `VALIDATION_ERROR`.
AC-023: `from > to` (cả hai được cung cấp) → 400 `INVALID_DATE_RANGE` (CD-003).
AC-024: `limit > 100` → 400 `VALIDATION_ERROR`.

---

## 8. Edge Cases

EC-001: Meeting chuyển từ `in_progress` sang `completed` đúng lúc client gọi GET → response vẫn 200 vì cả hai trạng thái đều hợp lệ; không có race condition vì đây là read-only.
EC-002: Meeting có ghi chú nhưng tất cả đều đã bị soft-delete → response 200, `data = []`, empty state message.
EC-003: Participant dùng `?noteType=host_note` → nếu có `host_note` nào đó với `visibility_level = 'participants'` (đã được Host share) thì được trả; nếu tất cả `host_note` đều private → trả empty.
EC-004: `from` lớn hơn `to` (cả hai đều được cung cấp) → 400 `INVALID_DATE_RANGE` với message rõ ràng; không thực hiện query (CD-003).
EC-005: `limit > 100` → 400 `VALIDATION_ERROR` (không tự ép về 100, để rõ ràng với client).
EC-006: Khi `includeSourceEvent=true`, note có `source_event_id` nhưng record `meeting_events` đã bị xóa hoặc không tìm thấy → response vẫn trả note đó với `sourceEventTime = null` và `sourceEventType = null`; không lỗi. Nếu không truyền `includeSourceEvent=true`, `sourceEventTime` và `sourceEventType` không xuất hiện trong response.
EC-007: Participant xem note của chính mình với `visibility_level = 'private'` → được trả về (`author_id = currentUserId`).
EC-008: Meeting ở trạng thái `scheduled` (chưa bắt đầu họp) → 422 `MEETING_STATUS_NOT_VIEWABLE`.
EC-009: Host dùng `?visibility=private` → trả tất cả private notes của meeting (Host xem được mọi thứ); không bị filter override.
EC-010: Participant dùng `?visibility=private` → sau khi áp role filter, Participant chỉ thấy private notes của chính mình (`author_id = currentUserId`); không thấy private notes của người khác.

---

## 9. Assumptions

- Schema `meeting_notes` đúng với DB v3.2 Compact hiện tại; không thêm cột mới.
- `meetings.host_id` là `uuid FK → users.id` hợp lệ và đủ tin cậy để xác định Host.
- `meeting_participants.participant_role` có giá trị `'host'` để double-check Host (cross-validate với `meetings.host_id`).
- API không hỗ trợ xác thực External Participant — `meeting_external_participants` không tham gia flow này.
- `note_type = 'system_note'` có thể xuất hiện trong DB (tạo bởi system) và Host được xem; Participant không xem được nếu `visibility_level = 'private'`.
- Content đã được sanitize XSS khi tạo (UC-102) — không cần sanitize lại khi đọc.
- `department_id` join qua `users.department_id` đủ để xác định cùng phòng ban; không cần đọc `departments` table.
- GIN index trên `meeting_notes.content` và `ix_meeting_notes_meeting` đã tồn tại (tạo bởi UC-102 migration).

---

## 10. Out of Scope

Các nội dung sau không thuộc UC-IMM-10:

- **POST tạo ghi chú** — thuộc UC-IMM-09 / UC-102.
- **PATCH cập nhật nội dung ghi chú** — UC riêng.
- **DELETE ghi chú (soft delete)** — UC riêng.
- **Share/unshare host_note** (thay đổi `visibility_level`) — UC riêng (PATCH operation).
- **Pin/unpin ghi chú** sau khi đã tạo — UC riêng (PATCH operation).
- **Full-text search** (GET với `?q`) — đặc tả trong UC-104; UC-IMM-10 không bao gồm FTS logic nhưng dùng cùng endpoint. Nếu triển khai cùng controller method, `?q` và các filter từ UC-IMM-10 có thể kết hợp — quyết định implementation thuộc plan/tasks.
- **Realtime WebSocket** cho note — không broadcast; dữ liệu lấy qua polling/fetch (quyết định từ UC-IMM-09).
- **Export danh sách ghi chú** thành PDF/DOCX — thuộc tính năng export/minutes.
- **Tag phân loại chi tiết** (Quyết định/Hành động/Ý tưởng) — không có cột `note_tag` trong DB v3.2 Compact; filter hiện tại dùng `noteType` làm proxy.
- **Đính kèm ghi chú vào email minutes** — thuộc module `minutes`/`notifications`.
- **AI summary** của ghi chú.
- **Ghi chú pre-meeting** hoặc của meeting chưa bắt đầu (`scheduled`).
- **External Participant** truy cập ghi chú.

**Future Enhancements (không implement trong v1):**
- Filter theo tag/category (yêu cầu thêm cột `note_tag` vào `meeting_notes` qua migration rõ ràng).
- Sort tùy chỉnh đa chiều (ví dụ: `pinned_first,timeline_asc`).
- Unaccent/diacritic-insensitive search cho tiếng Việt.
- `last_read_at` tracking per user (read receipt).

---

## 11. API Contract Notes

### Endpoint

`GET /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.read`
**Auth**: JWT required (`JwtAuthGuard`)
**Async**: No

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | UUID | Yes | ID cuộc họp cần xem ghi chú |

### Query Parameters

| Field | Type | Required | Default | Rule |
|-------|------|----------|---------|------|
| `noteType` | string | No | — | filter theo `note_type`: `in_meeting` \| `private` \| `host_note` \| `system_note` |
| `visibility` | string | No | — | filter thêm theo `visibility_level`: `private` \| `participants` \| `public_internal` \| `department` — áp SAU role filter |
| `pinned` | boolean | No | — | `true` = chỉ ghim; `false` = chỉ không ghim |
| `from` | string (ISO 8601) | No | — | filter `created_at >= from` (inclusive); có thể gửi độc lập không cần `to` (CD-003) |
| `to` | string (ISO 8601) | No | — | filter `created_at <= to` (inclusive); có thể gửi độc lập không cần `from` (CD-003) |
| `includeSourceEvent` | boolean | No | `false` | `true` = enrich mỗi note có `source_event_id` với `sourceEventTime` và `sourceEventType` từ `meeting_events` (CD-001) |
| `page` | number | No | `1` | ≥ 1 |
| `limit` | number | No | `20` | 1..100 (trả 400 nếu > 100) |
| `sort` | string | No | `timeline_asc` | `timeline_asc` \| `timeline_desc` |

> **Về tham số `tag`**: Không có cột `tag` trong DB v3.2 Compact. Filter theo loại ghi chú dùng `noteType` ở v1. Tham số `tag` sẽ được hỗ trợ trong Future Enhancement khi schema có cột riêng.

> **Về `pageSize`**: Tham số chuẩn theo API convention dự án (AGENTS.md §8.4) là `limit`, không phải `pageSize`. Dùng `limit` để nhất quán với các endpoint khác.

### Response 200 — Có dữ liệu (mặc định, không `includeSourceEvent`)

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [
    {
      "id": "uuid",
      "meetingId": "uuid",
      "noteType": "in_meeting",
      "content": "Quyết định: Triển khai module X vào Q3",
      "pinned": false,
      "visibilityLevel": "participants",
      "author": {
        "id": "uuid",
        "fullName": "Nguyễn Văn A"
      },
      "sourceEventId": null,
      "noteTimestamp": "2026-06-18T09:45:00+07:00",
      "updatedAt": "2026-06-18T09:45:00+07:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

> `noteTimestamp` ánh xạ từ `meeting_notes.created_at` (CD-001). Không có `sourceEventTime` / `sourceEventType` trong response mặc định.

### Response 200 — Có dữ liệu với `?includeSourceEvent=true`

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [
    {
      "id": "uuid",
      "meetingId": "uuid",
      "noteType": "in_meeting",
      "content": "Quyết định: Triển khai module X vào Q3",
      "pinned": false,
      "visibilityLevel": "participants",
      "author": {
        "id": "uuid",
        "fullName": "Nguyễn Văn A"
      },
      "sourceEventId": "uuid",
      "sourceEventTime": "2026-06-18T09:43:00+07:00",
      "sourceEventType": "meeting_started",
      "noteTimestamp": "2026-06-18T09:45:00+07:00",
      "updatedAt": "2026-06-18T09:45:00+07:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

> Khi `includeSourceEvent=true`, `sourceEventTime` và `sourceEventType` được trả thêm cho các note có `source_event_id IS NOT NULL`. Nếu record `meeting_events` không tồn tại, `sourceEventTime = null` và `sourceEventType = null`.

### Response 200 — Empty State

```json
{
  "success": true,
  "message": "Cuộc họp này không có ghi chú nào được lưu lại.",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

---

## 12. Data Model Mapping

### Không thêm bảng mới. Không thêm cột mới.

Sử dụng hoàn toàn schema DB v3.2 Compact hiện tại.

| Bảng | Cột sử dụng | Mục đích |
|---|---|---|
| `meeting_notes` | `id`, `meeting_id`, `author_id`, `note_type`, `content`, `pinned`, `visibility_level`, `source_event_id`, `created_at`, `updated_at`, `deleted_at` | Nguồn dữ liệu chính; filter + sort + paginate |
| `meetings` | `id`, `status`, `host_id`, `deleted_at` | Validate meeting tồn tại, status hợp lệ, xác định host_id |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Validate actor là Host/Participant; xác định participant_role |
| `users` | `id`, `full_name`, `department_id` | JOIN author info cho response; department check cho visibility `department` |
| `meeting_events` | `id`, `event_time`, `event_type` | Chỉ JOIN khi `includeSourceEvent=true` (opt-in per CD-001); lấy `event_time` → `sourceEventTime` và `event_type` → `sourceEventType` |

### Query logic outline

```sql
-- Bước 1: Validate meeting
SELECT id, status, host_id
FROM meetings
WHERE id = :meetingId AND deleted_at IS NULL;
-- status phải là 'in_progress' hoặc 'completed'

-- Bước 2: Xác định actor role trong meeting
SELECT participant_role
FROM meeting_participants
WHERE meeting_id = :meetingId AND user_id = :currentUserId;
-- isHost = (meetings.host_id = currentUserId) OR (participant_role = 'host')
-- isParticipant = record tồn tại

-- Bước 3a: Query notes — Host path (không có visibility filter)
-- LEFT JOIN meeting_events chỉ thực hiện khi includeSourceEvent=true (CD-001)
SELECT mn.*, u.full_name AS author_full_name, u.id AS author_id
       -- , me.event_time AS source_event_time, me.event_type AS source_event_type
       --   (chỉ SELECT khi includeSourceEvent=true)
FROM meeting_notes mn
JOIN users u ON mn.author_id = u.id
-- LEFT JOIN meeting_events me ON mn.source_event_id = me.id  (opt-in only)
WHERE mn.meeting_id = :meetingId
  AND mn.deleted_at IS NULL
  -- Optional filters
  AND (:noteType IS NULL OR mn.note_type = :noteType)
  AND (:visibility IS NULL OR mn.visibility_level = :visibility)
  AND (:pinned IS NULL OR mn.pinned = :pinned)
  AND (:from IS NULL OR mn.created_at >= :from)
  AND (:to IS NULL OR mn.created_at <= :to)
ORDER BY mn.created_at ASC -- hoặc DESC nếu sort=timeline_desc
LIMIT :limit OFFSET (:page - 1) * :limit;

-- Bước 3b: Query notes — Participant path (có visibility filter)
WHERE mn.meeting_id = :meetingId
  AND mn.deleted_at IS NULL
  AND (
    mn.author_id = :currentUserId
    OR mn.visibility_level = 'participants'
    OR mn.visibility_level = 'public_internal'
    OR (mn.visibility_level = 'department'
        AND EXISTS (
          SELECT 1 FROM users u2
          WHERE u2.id = mn.author_id
            AND u2.department_id = :currentUserDeptId
        ))
  )
  -- Áp filter từ query param SAU visibility predicate
  AND (:noteType IS NULL OR mn.note_type = :noteType)
  AND (:visibility IS NULL OR mn.visibility_level = :visibility)
  AND (:pinned IS NULL OR mn.pinned = :pinned)
  AND (:from IS NULL OR mn.created_at >= :from)
  AND (:to IS NULL OR mn.created_at <= :to)
ORDER BY mn.created_at ASC
LIMIT :limit OFFSET (:page - 1) * :limit;
```

---

## 13. Authorization & Visibility Rules

### 13.1 Xác định Host

Actor là Host của meeting nếu thỏa **một** trong hai điều kiện (OR):
1. `meetings.host_id = currentUserId`
2. Tồn tại record `meeting_participants` với `meeting_id = :meetingId AND user_id = currentUserId AND participant_role = 'host'`

### 13.2 Xác định Participant hợp lệ

Actor là Participant hợp lệ nếu tồn tại record `meeting_participants` với `meeting_id = :meetingId AND user_id = currentUserId` (bất kể `participant_role`).

### 13.3 Visibility Matrix

| Actor Role | Thấy được ghi chú | Không thấy |
|---|---|---|
| **Host** | TẤT CẢ ghi chú `deleted_at IS NULL` của meeting | Ghi chú `deleted_at IS NOT NULL` |
| **Participant** (non-Host) | Ghi chú của chính mình (`author_id = currentUserId`) | Private notes của người khác |
| **Participant** (non-Host) | Ghi chú có `visibility_level = 'participants'` | `host_note` với `visibility_level = 'private'` |
| **Participant** (non-Host) | Ghi chú có `visibility_level = 'public_internal'` | Bất kỳ note nào có `visibility_level = 'private'` và `author_id != currentUserId` |
| **Participant** (non-Host) | Ghi chú có `visibility_level = 'department'` (cùng phòng ban) | — |

### 13.4 Quy tắc bất biến (Invariants)

- **[INVARIANT-1]**: Private notes (`visibility_level = 'private'`) của bất kỳ author nào **không bao giờ** được trả về cho user khác không phải author đó, ngoại trừ Host (Host có toàn quyền).
- **[INVARIANT-2]**: `note_type = 'host_note'` với `visibility_level = 'private'` **không bao giờ** xuất hiện trong response của Participant.
- **[INVARIANT-3]**: Ghi chú `deleted_at IS NOT NULL` **không bao giờ** được trả về, dù là Host hay Participant.
- **[INVARIANT-4]**: Filter query param `?visibility=private` từ Participant **không** override INVARIANT-1; Participant chỉ thấy private notes của chính mình khi dùng filter này.

### 13.5 Không cho phép bypass membership (CD-002)

UC-IMM-10 **không** cung cấp cơ chế bypass membership cho bất kỳ role hệ thống nào:

- System Admin, Business Admin, Manager, hoặc user chỉ có permission `meeting.note.read` mà **không** là Host hoặc Participant hợp lệ của meeting → bị từ chối với `403 NOT_A_MEETING_PARTICIPANT`.
- Việc có quyền admin cao cấp không đồng nghĩa với quyền xem ghi chú của meeting tùy ý.
- Nếu tổ chức cần chức năng audit/giám sát ghi chú bất kể membership, phải tạo use case riêng với permission `meeting.notes.audit.read` — **nằm ngoài scope UC-IMM-10**.

---

## 14. Error Handling

| HTTP Status | Error Code | Mô tả chi tiết |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | `meetingId` không hợp lệ UUID; `from`/`to` không phải ISO datetime; `limit > 100`; `noteType`/`visibility`/`sort` ngoài allowlist |
| 400 | `INVALID_DATE_RANGE` | Cả `from` và `to` đều được cung cấp nhưng `from > to` (CD-003) |
| 401 | `UNAUTHORIZED` | Chưa xác thực / JWT không hợp lệ hoặc hết hạn |
| 403 | `PERMISSION_DENIED` | Thiếu permission `meeting.note.read` |
| 403 | `NOT_A_MEETING_PARTICIPANT` | User đã xác thực nhưng không phải Host hay Participant hợp lệ của meeting — kể cả admin/manager (BR-016) |
| 404 | `MEETING_NOT_FOUND` | `meetingId` không tồn tại hoặc `deleted_at IS NOT NULL` |
| 422 | `MEETING_STATUS_NOT_VIEWABLE` | Meeting ở trạng thái `draft`, `pending_approval`, `scheduled`, hoặc `cancelled` |
| 500 | `INTERNAL_ERROR` | Lỗi server không xác định |

**Quy tắc xử lý lỗi:**
- Không expose stack trace ở môi trường production.
- Error response format chuẩn (theo AGENTS.md §8.2):
  ```json
  { "success": false, "message": "...", "error": { "code": "...", "details": {} }, "timestamp": "...", "path": "..." }
  ```
- Lỗi 403 `NOT_A_MEETING_PARTICIPANT` trả message: `"Bạn không có quyền xem ghi chú của cuộc họp này."` — không tiết lộ chi tiết nội dung cuộc họp cho user không có quyền.
- Không log `content` ghi chú đầy đủ trong error log; chỉ log meta (meetingId, noteType, authorId) ở mức cần thiết.

---

## 15. Audit / Read-only Decision

Tính năng UC-IMM-10 là **read-only hoàn toàn**.

| Mục | Quyết định | Lý do |
|---|---|---|
| Ghi `audit_logs` | **Không** | GET đọc dữ liệu không tạo side effect có nghĩa nghiệp vụ |
| Ghi `meeting_events` | **Không** | Không thay đổi trạng thái meeting |
| Ghi `notifications` | **Không** | Xem ghi chú không kích hoạt thông báo |
| Database transaction | **Không cần ghi** | Chỉ SELECT; dùng read-only context nếu framework hỗ trợ |
| Side effect | **Không có** | Không thay đổi `updated_at`, không cập nhật `last_read_at`, không increments counter |

**Lý do không có audit log cho GET:**
- Audit log chỉ ghi cho hành động có thể gây ra thay đổi trạng thái quan trọng (approval, cancellation, room release…).
- Read-only query không tạo risk bảo mật cần trace theo AGENTS.md §17.
- Nếu team muốn analytics về "ai xem ghi chú khi nào", cần tính năng riêng (nằm ngoài scope UC-IMM-10).

---

## 16. Non-Functional Requirements

NFR-001: THE system SHALL return response trong điều kiện tải bình thường; query phải sử dụng index `ix_meeting_notes_meeting ON meeting_notes(meeting_id)` để tránh full table scan.
NFR-002: THE system SHALL enforce visibility filter nghiêm ngặt theo INVARIANT-1, INVARIANT-2, INVARIANT-3, INVARIANT-4 — không để lộ private notes qua bất kỳ path nào.
NFR-003: THE system SHALL NOT execute any INSERT/UPDATE/DELETE statement during this operation.
NFR-004: THE system SHALL có unit test cho: Host xem tất cả notes, Participant visibility filter, block private notes invariants, empty state, filter by noteType/pinned/from/to/visibility, sort, pagination, các error case.
NFR-005: THE system SHALL trả lại `content` đã sanitize (không cần sanitize lại lần nữa ở GET nếu đã sanitize khi tạo ở UC-102).

---

## 17. Acceptance Criteria Traceability

| AC ID | Nội dung tóm tắt | FR / BR liên quan | Test case đề xuất |
|-------|------------------|-------------------|-------------------|
| AC-001 | Host xem notes khi `in_progress` → tất cả hợp lệ, sorted ASC | FR-007, BR-004, BR-007 | Service: Host view all - in_progress |
| AC-002 | Host xem notes khi `completed` → tất cả hợp lệ | FR-007, BR-001, BR-004 | Service: Host view all - completed |
| AC-003 | Không trả note `deleted_at IS NOT NULL` | FR-009, BR-003 | Service: Deleted notes excluded |
| AC-004 | Mỗi note có `author.id` và `author.fullName` | FR-019 | Service: Author info present |
| AC-005 | Participant chỉ thấy shared + own notes | FR-008, BR-005 | Service: Participant visibility filter |
| AC-006 | Private note `author != participant` không trong response | FR-008, BR-005, BR-006, INVARIANT-1 | Service: Private notes blocked for participant |
| AC-007 | `host_note` private không trong response Participant | FR-008, BR-006, INVARIANT-2 | Service: host_note private blocked |
| AC-008 | Filter `?noteType=in_meeting` | FR-011, BR-009 | Service: Filter by note type |
| AC-009 | Filter `?pinned=true` | FR-013 | Service: Filter by pinned |
| AC-010 | Filter `?from=...&to=...` date range (độc lập hoặc kết hợp) | FR-014, BR-013, CD-003 | Service: Date range filter — both, from-only, to-only |
| AC-011 | Filter `?visibility=participants` áp sau role filter | FR-012, BR-015 | Service: Visibility query param |
| AC-012 | `?sort=timeline_asc` (default) → ASC | FR-010, BR-007 | Service: Sort ASC |
| AC-013 | `?sort=timeline_desc` → DESC | FR-010, BR-008 | Service: Sort DESC |
| AC-014 | Empty state → 200, data=[], total=0, empty message | FR-018, BR-012 | Service: Empty state |
| AC-015 | Pagination `?page=2&limit=5` | FR-015, BR-014 | Service: Pagination |
| AC-016 | `meta.totalPages` đúng | FR-016 | Service: Meta calculation |
| AC-017 | Chưa đăng nhập → 401 | FR-001 | Controller: Auth guard |
| AC-018 | Thiếu permission → 403 `PERMISSION_DENIED` | FR-002 | Controller: Permission guard |
| AC-019 | Không phải participant → 403 `NOT_A_MEETING_PARTICIPANT` | FR-006, BR-002 | Service: Not a participant |
| AC-020 | `meetingId` không tồn tại → 404 | FR-004 | Service: Meeting not found |
| AC-021 | Meeting trạng thái sai → 422 | FR-005, BR-001 | Service: Invalid status |
| AC-022 | `from` sai định dạng → 400 `VALIDATION_ERROR` | FR-014 | DTO/Service: Invalid date format |
| AC-023 | `from > to` (cả hai) → 400 `INVALID_DATE_RANGE` | FR-014, CD-003 | Service: from > to → INVALID_DATE_RANGE |
| AC-024 | `limit > 100` → 400 | FR-015, BR-014 | DTO: Limit exceeds max |
