# Feature Specification: Tìm kiếm ghi chú trong cuộc họp (Search Meeting Notes)

- **Feature ID**: UC-IMM-11 / UC-104
- **Feature Name**: Tìm kiếm ghi chú trong cuộc họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-18
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables) — bảng `meeting_notes`
  - API_CONTRACT_v1.0_with_system_roles.md (UC-102, UC-103, UC-104)
  - AGENTS.md - Backend Agent Guide v1.1
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - spec_typeorm_aligned.md
  - feat-view-meeting-notes/spec.md (UC-IMM-10) — đồng bộ visibility rules, auth, pagination, response format, error codes
  - feat-in-meeting-notes/spec.md (UC-IMM-09) — đồng bộ convention notes entity, source_event_id, note_type enum

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo spec.md lần đầu cho UC-IMM-11 Tìm kiếm ghi chú trong cuộc họp — read-only, full-text search, visibility rules, author/time range filter, pagination, empty state, Vietnamese unaccent limitation | Toàn bộ file |

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

Tính năng UC-IMM-11 thuộc nhóm In-Meeting Management, module `live-meeting`.

Sau khi ghi chú được tạo (UC-IMM-09 / UC-102) và người dùng đã có thể xem danh sách ghi chú (UC-IMM-10 / UC-103), nhu cầu tiếp theo là tìm kiếm nhanh trong nội dung ghi chú — khi meeting có nhiều ghi chú qua nhiều phiên hoặc nội dung dài, người dùng cần filter theo từ khóa, theo người tạo, hoặc theo khoảng thời gian để tìm lại thông tin quan trọng.

Tính năng này hoạt động ở hai ngữ cảnh:

1. **Meeting Dashboard** (khi meeting `in_progress`): Người dùng tìm kiếm ghi chú trong phiên họp đang diễn ra — tra nhanh quyết định đã được ghi trước đó.
2. **Meeting Detail** (khi meeting `completed`): Người dùng tìm kiếm lại ghi chú sau họp — tham chiếu thông tin cho minutes hoặc action items.

Feature này xây dựng hoàn toàn trên cùng endpoint với UC-IMM-10 (`GET /api/v1/meetings/{meetingId}/notes`), mở rộng thêm query param `?q=` để thực hiện full-text search và các filter `?authorId=`, `?createdFrom=`, `?createdTo=`. Các quy tắc visibility, auth, pagination được kế thừa từ UC-IMM-10.

**Đây là read-only hoàn toàn**: không tạo mới, không cập nhật, không xóa ghi chú. Không có side effect lên bất kỳ bảng nào.

### 1.2 Mục tiêu

- Cho phép Host và Participant hợp lệ tìm kiếm ghi chú theo từ khóa, người tạo, khoảng thời gian.
- Full-text search trên trường `content` của `meeting_notes`, case-insensitive.
- Hỗ trợ tìm kiếm tiếng Việt không dấu ở mức nghiệp vụ. Feature KHÔNG bắt buộc phải tự tạo PostgreSQL extension unaccent. Nếu DB chưa có extension, hệ thống fallback về case-insensitive search (application-layer normalization hoặc alternative strategy được dự án chấp thuận). Mọi thay đổi schema/index/extension cho search optimization được xử lý ở plan/tasks, không mở rộng trong spec này.
- Kiểm soát **nghiêm ngặt** visibility theo `visibility_level` và vai trò trong meeting (kế thừa UC-IMM-10):
  - **Host** tìm kiếm trên toàn bộ ghi chú hợp lệ, bao gồm private notes của bất kỳ ai.
  - **Co-host** tìm kiếm gần tương đương Host nhưng **không thấy private notes** của người khác.
  - **Participant** chỉ tìm thấy ghi chú được chia sẻ cho participants và ghi chú của chính họ.
- Trả kết quả theo thứ tự thời gian (`created_at ASC` mặc định).
- Hỗ trợ pagination đầy đủ.
- Trả empty state rõ ràng khi không có kết quả.
- Không thay đổi bất kỳ dữ liệu nào — read-only.

### 1.3 Giả định

- Endpoint `GET /api/v1/meetings/{meetingId}/notes` là endpoint chung cho cả UC-103 (xem) và UC-104 (tìm kiếm). Query param `?q=` kích hoạt chế độ search. Nếu không có `?q=`, behavior giống UC-103.
- GIN index trên `meeting_notes.content` đã tồn tại hoặc được tạo sau migration từ UC-102/UC-103.
- Vietnamese unaccent search chỉ khả dụng khi PostgreSQL extension `unaccent` được cài đặt và index phù hợp được tạo. Nếu chưa có, spec ghi rõ đây là implementation limitation, không ảnh hưởng đến logic business.
- Không có cột `tag` trong schema `meeting_notes` hiện tại. Filter theo tag dùng `noteType` làm proxy. Tag chi tiết là Future Enhancement.
- Actor đã đăng nhập, có JWT token hợp lệ và permission `meeting.note.read`.
- Meeting ở trạng thái `in_progress` hoặc `completed`.
- External participant không thuộc scope.

### 1.4 Clarification Decisions (đã giải quyết)

**CD-001 — Search Scope**: Search chỉ hoạt động trên `meeting_notes.content`. Không mở rộng search ra `meeting_events`, `meeting_minutes`, hay bất kỳ bảng nào khác. Nếu cần cross-entity search, cần use case riêng.

**CD-002 — Tag Filter**: Do DB v3.2 Compact không có cột `tag` trong `meeting_notes`, filter theo tag dùng `noteType` (`?noteType=in_meeting&q=keyword`) làm proxy trong v1. Tag riêng biệt (ví dụ: "Quyết định", "Hành động", "Ý tưởng") là Future Enhancement.

***CD-003 — Vietnamese Unaccent (CR-001)**: Feature yêu cầu search hỗ trợ tiếng Việt không dấu ở mức nghiệp vụ, nhưng KHÔNG bắt buộc feature tự tạo PostgreSQL extension unaccent.
  - Nếu môi trường DB đã bật unaccent, backend có thể dùng unaccent(lower(content)) hoặc full-text strategy tương đương.
  - Nếu DB user không có quyền CREATE EXTENSION, hệ thống không được crash khi deploy/migrate.
  - Không tự động chạy CREATE EXTENSION IF NOT EXISTS unaccent; trong migration của feature này nếu chưa có quyết định hạ tầng rõ ràng.
  - Fallback hợp lệ: normalize keyword và content/search index ở application layer hoặc dùng strategy khác đã được dự án chấp thuận.
  - Mọi thay đổi schema/index/extension riêng cho search optimization phải được xử lý ở plan/tasks/migration sau, không tự mở rộng trong spec.md.

---

## 2. Actor & Roles

### Primary Actor

- **Host** (`meeting_participants.participant_role = 'host'`): Chủ trì meeting. Có toàn quyền search tất cả ghi chú hợp lệ của meeting, bao gồm private notes của bất kỳ user nào. Permission: `meeting.note.read`.
- **Co-host** (`meeting_participants.participant_role = 'co_host'`): Người đồng điều hành meeting. Được search ghi chú phục vụ điều hành cuộc họp, **nhưng không được xem private notes** của user khác. Permission: `meeting.note.read`.
- **Participant**: Người tham gia nội bộ (không phải Host/Co-host). Chỉ search được shared/public notes và ghi chú của chính họ. Không được xem private notes của người khác. Permission: `meeting.note.read`.
### Secondary Actor

- **System**: Thực thi full-text search query.

### Ngoài scope

- **External Participant**: Không có tài khoản; API không hỗ trợ xác thực external.
- Bất kỳ user nào không có permission `meeting.note.read`.
- Bất kỳ user nào không phải Host, Co-host hoặc Participant hợp lệ — kể cả System Admin, Business Admin, Manager (kế thừa CD-002 từ UC-IMM-10).

---

## 3. Business Rules

**Quy tắc kế thừa từ UC-IMM-10 (giữ nguyên):**

BR-001: Meeting phải ở trạng thái `in_progress` hoặc `completed`; tất cả trạng thái khác (`draft`, `pending_approval`, `scheduled`, `cancelled`) bị từ chối.
BR-002: Actor phải là Host, Co-host hoặc Participant hợp lệ của meeting — tồn tại trong `meeting_participants` với `user_id = currentUserId` (bất kỳ `participant_role` nào gồm `host`, `co_host`, `participant`), hoặc là `meetings.host_id`. User không thuộc meeting, user đã bị loại khỏi phạm vi truy cập, hoặc không còn hợp lệ trong meeting, hoặc meeting/note bị soft-delete đều bị từ chối. User không thuộc meeting hoặc không còn hợp lệ trong meeting không được tìm kiếm hoặc nhìn thấy bất kỳ note nào của meeting.
BR-003: Ghi chú với `deleted_at IS NOT NULL` không bao giờ được trả về trong response.
BR-004: **Host** thấy tất cả ghi chú hợp lệ (`deleted_at IS NULL`) của meeting, bao gồm tất cả `visibility_level`, kể cả private notes (`visibility_level = 'private'`) của bất kỳ user nào. Host không có `visibility_level` restriction.
BR-005: **Participant** (không phải Host/Co-host) chỉ thấy ghi chú thỏa một trong các điều kiện: `author_id = currentUserId` (ghi chú của chính mình, bất kể `visibility_level`), `visibility_level IN ('participants', 'public_internal')` (được chia sẻ), hoặc cùng `department_id`. Participant không được xem private notes của Host, co-host hoặc participant khác.
BR-006: Private notes (`visibility_level = 'private'`) của người khác (`author_id != currentUserId`) tuyệt đối không được trả về cho Participant hoặc Co-host. Chỉ Host và chính author của note được xem private note đó.
BR-007: Danh sách sắp xếp mặc định theo `created_at ASC`.
BR-008: `sort=timeline_desc` đảo ngược thứ tự.
BR-009: Đây là **read-only** operation.
BR-010: Không có cột `tag` — filter tag dùng `noteType` làm proxy (CD-002).
BR-011: Pagination: default `page = 1`, default `limit = 20`, max `limit = 100`.
BR-012: Empty state: HTTP 200, `data = []`, `meta.total = 0`, message: `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."`

**Quy tắc riêng của UC-IMM-11 (search):**

BR-013: Search keyword (`?q=`) được trim whitespace. IF `q` rỗng hoặc chỉ whitespace, THEN bỏ qua search và trả toàn bộ danh sách đã filter (hoạt động như UC-103 view).
BR-014: Search thực hiện trên `meeting_notes.content` với case-insensitive matching.
BR-015: `WHERE` DB có extension `unaccent` và GIN index phù hợp, search hỗ trợ Vietnamese accent-insensitive matching; `WHERE` chưa có, fallback về case-insensitive `ILIKE`.
BR-016: Search được thực hiện SAU visibility filter (BR-004/BR-005) — không cho phép keyword search bypass visibility rules.
BR-017: Search kết hợp với các filter khác (`?noteType`, `?visibility`, `?pinned`, `?authorId`, `?from`, `?to`) bằng AND logic — tất cả điều kiện phải đồng thời thỏa mãn.
BR-018: Filter `?authorId` validate rằng UUID hợp lệ; IF hợp lệ, filter `meeting_notes.author_id = :authorId`. Nếu Host, không giới hạn (xem tất cả notes của author đó). Nếu Co-host, chỉ xem được notes của author đó nếu note không phải private của người khác. Nếu Participant, `authorId` phải là `currentUserId` hoặc nằm trong các note mà Participant có quyền xem (kết hợp BR-005, BR-020).
BR-019: Filter `?createdFrom` và `?createdTo` (tương tự UC-IMM-10 `from`/`to`) — ISO datetime, inclusive, có thể dùng độc lập.
BR-020: **Co-host** được xem gần tương đương Host đối với notes phục vụ điều hành cuộc họp, nhưng **không được xem private notes của user khác**. Co-host thấy tất cả ghi chú hợp lệ (deleted_at IS NULL) của meeting NGOẠI TRỪ private notes mà isibility_level = 'private' và uthor_id != currentUserId. Nói cách khác: ngoại trừ Host, không user nào khác — kể cả co_host — được xem private notes của user khác. (CR-002)
BR-021: Query param q max length 255 ký tự. IF q exceeds 255 characters, THEN reject với VALIDATION_ERROR. (CR-003)
BR-022: IF implementation fallback sang ILIKE, backend MUST escape %, _ và \ trong keyword từ client để tránh wildcard injection. (CR-004)

---

## 4. Functional Requirements

### 4.1 Xác thực và phân quyền (kế thừa UC-IMM-10)

FR-001: THE system SHALL require valid JWT authentication for all requests to this endpoint.
FR-002: THE system SHALL validate actor has permission `meeting.note.read`; IF not, THEN return 403 `PERMISSION_DENIED`.
FR-003: THE system SHALL validate `meetingId` is a valid UUID format; IF invalid, THEN return 400 `VALIDATION_ERROR`.
FR-004: THE system SHALL validate meeting exists and `deleted_at IS NULL`; IF not found, THEN return 404 `MEETING_NOT_FOUND`.
FR-005: THE system SHALL validate meeting `status` is `in_progress` or `completed`; IF other status, THEN return 422 `MEETING_STATUS_NOT_VIEWABLE`.
FR-006: THE system SHALL validate actor is Host, Co-host, or valid Participant of the meeting (BR-002). Actor is eligible IF `meeting_participants.user_id = currentUserId` with `participant_role` `host`, `co_host`, or `participant`, OR `meetings.host_id = currentUserId`. IF not eligible (user không thuộc meeting, đã bị loại khỏi phạm vi truy cập, hoặc không còn hợp lệ), THEN return 403 `NOT_A_MEETING_PARTICIPANT`.

### 4.2 Search

FR-007: WHEN `?q=` query param is provided AND its length ? 255 characters after trim, THE system SHALL perform full-text search on `meeting_notes.content` with case-insensitive matching (BR-014). IF `q` exceeds 255 characters, THEN reject with VALIDATION_ERROR (BR-021, CR-003).
FR-008: WHERE DB supports PostgreSQL `unaccent` extension (via application-layer normalization or extension), THE system SHALL perform Vietnamese accent-insensitive search on `meeting_notes.content` (BR-015). Feature MUST NOT crash if extension is unavailable; use fallback per FR-009.
FR-009: WHERE DB does NOT support `unaccent` or extension is unavailable, THE system SHALL fallback to case-insensitive matching on `meeting_notes.content` ? `ILIKE` with proper wildcard escaping (per BR-022) or application-layer normalization (BR-015, CD-003, CR-001).
FR-010: IF `?q=` is empty or whitespace-only after trim, THE system SHALL ignore the search parameter and return notes based on other filters only (BR-013).
FR-011: THE system SHALL apply visibility filter (BR-004 for Host, BR-005 for Participant) BEFORE applying search keyword filter — search never bypasses visibility (BR-016).
FR-012: THE system SHALL combine `?q=` with other filter params (`?noteType`, `?visibility`, `?pinned`, `?authorId`, `?from`, `?to`) using AND logic (BR-017).

### 4.3 Filter

FR-013: THE system SHALL support optional filter by `authorId` (UUID) on `meeting_notes.author_id`; IF provided, validate UUID format; IF not a valid UUID, THEN return 400 `VALIDATION_ERROR` (BR-018).
FR-014: THE system SHALL support optional filter by `createdFrom` (ISO 8601 datetime) on `meeting_notes.created_at >= :createdFrom` (inclusive); IF provided, validate ISO datetime format (BR-019).
FR-015: THE system SHALL support optional filter by `createdTo` (ISO 8601 datetime) on `meeting_notes.created_at <= :createdTo` (inclusive); IF provided, validate ISO datetime format (BR-019).
FR-016: IF both `createdFrom` and `createdTo` provided AND `createdFrom > createdTo`, THEN THE system SHALL return 400 `INVALID_DATE_RANGE`.
FR-017: THE system SHALL support optional filter by `noteType`; IF provided, validate value is in allowlist `['in_meeting', 'private', 'host_note', 'system_note']`.
FR-018: THE system SHALL support optional filter by `visibility`; IF provided, validate value is in allowlist `['private', 'participants', 'public_internal', 'department']`.
FR-019: THE system SHALL support optional filter by `pinned` (boolean).

### 4.4 Sorting và Pagination

FR-020: THE system SHALL sort results by `created_at ASC` by default; IF `sort=timeline_desc`, THEN sort by `created_at DESC`.
FR-021: THE system SHALL support pagination via `page` (default 1, min 1) and `limit` (default 20, min 1, max 100); IF `limit > 100`, THEN return 400.
FR-022: THE system SHALL return pagination metadata: `page`, `limit`, `total`, `totalPages`.

### 4.5 Response

FR-023: THE system SHALL return note timestamp as `noteTimestamp` (mapped from `meeting_notes.created_at`) in every response item.
FR-024: THE system SHALL include author information in each note item: `author.id` and `author.fullName`.
FR-025: IF no notes match after all filters, visibility rules, and search, THE system SHALL return HTTP 200 with `data = []` and message `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."` (BR-012).
FR-026: THE system SHALL NOT write to any database table during this operation (BR-009).
FR-027: THE system SHALL exclude all notes where `deleted_at IS NOT NULL` from every response path (BR-003).
FR-028: IF implementation uses `ILIKE` fallback for search, THE system SHALL escape wildcard characters `%`, `_` and escape character `\` in the keyword from client, and use parameterized query with `ILIKE :keyword ESCAPE '\'` syntax. Wildcard characters MUST be treated as literal search characters, not as pattern-matching operators. (CR-004, BR-022).

---

## 5. Key Entities

### 5.1 Bảng chính: `meeting_notes`

| Column | Type | Vai trò trong UC-IMM-11 |
|---|---|---|
| `id` | `uuid PK` | Khóa chính trả về trong response |
| `meeting_id` | `uuid FK → meetings.id` | Filter ghi chú theo meeting (required) |
| `author_id` | `uuid FK → users.id` | Filter `?authorId=`; visibility rule cho Participant |
| `note_type` | `varchar(30)` | Filter `?noteType=` |
| `content` | `text NOT NULL` | Trường search chính — full-text search / ILIKE |
| `pinned` | `boolean DEFAULT false` | Filter `?pinned=` |
| `visibility_level` | `varchar(30) DEFAULT 'participants'` | Quy tắc visibility — phân quyền đọc theo BR-004/BR-005 |
| `source_event_id` | `uuid FK → meeting_events.id` | Trả trong response nếu có |
| `created_at` | `timestamptz` | Sắp xếp timeline; filter `?createdFrom=` / `?createdTo=` |
| `updated_at` | `timestamptz` | Thông tin cập nhật cuối |
| `deleted_at` | `timestamptz` | Luôn lọc `IS NULL` |

### 5.2 Bảng validate/join

| Bảng | Cột sử dụng | Mục đích |
|---|---|---|
| `meetings` | `id`, `status`, `host_id`, `deleted_at` | Validate tồn tại, status hợp lệ, xác định host |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Validate quyền search; xác định Host/Participant |
| `users` | `id`, `full_name`, `department_id` | Join author info; department check cho visibility `department` |

---

## 6. User Scenarios & Testing

### Scenario 1 — Host search keyword

**Actor**: Host của meeting
**Precondition**: Meeting `in_progress`; có nhiều notes bao gồm `in_meeting`, `host_note`, `private` của participant
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=triển khai`
**Expected**: 200, trả tất cả notes chứa "triển khai" không phân biệt visibility (Host thấy tất cả)

### Scenario 2 — Participant search keyword

**Actor**: Participant (non-Host)
**Precondition**: Meeting `completed`; có notes với nội dung "quyết định" gồm shared và private
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=quyết định`
**Expected**: 200, chỉ trả shared notes khớp keyword + notes của chính participant; không trả private notes của người khác

### Scenario 3 — Search kết hợp filter authorId và time range

**Actor**: Host
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=API&authorId=<uuid>&createdFrom=2026-06-01T00:00:00Z&createdTo=2026-06-18T23:59:59Z`
**Expected**: 200, chỉ notes khớp keyword "API", đúng author, trong khoảng thời gian

### Scenario 4 — Search không có kết quả

**Actor**: Participant
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=xyznonexistent`
**Expected**: 200, `data = []`, `meta.total = 0`, message `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."`

### Scenario 5 — Search với keyword rỗng

**Actor**: Participant
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=`
**Expected**: 200, trả toàn bộ danh sách notes hợp lệ (behavior như UC-103)

### Scenario 6 — Người dùng không phải participant

**Actor**: Internal user không có trong meeting
**Action**: `GET /api/v1/meetings/{meetingId}/notes?q=keyword`
**Expected**: 403 `NOT_A_MEETING_PARTICIPANT`

---

## 7. Acceptance Criteria

**Primary flow — Search keyword:**

AC-001: Host search `?q=triển khai` khi meeting `in_progress` → response 200, tất cả notes hợp lệ chứa "triển khai" được trả, sorted `created_at ASC`.
AC-002: Participant search `?q=quyết định` → chỉ trả notes khớp mà Participant có quyền xem (shared/own); private notes của người khác không xuất hiện.
AC-003: Search `?q=keyword` kết hợp visibility filter — không có private note nào của người khác xuất hiện dù keyword khớp.

**Search edge cases:**

AC-004: `?q=` rỗng → behavior giống UC-103 view (trả toàn bộ notes hợp lệ).
AC-005: `?q=xyznotexist` → 200, `data = []`, `total = 0`, message `"Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn."`.
AC-006: `?q=keyword` case-insensitive → "Triển Khai" và "triển khai" cùng trả kết quả.
AC-007: `?q=keyword` tiếng Việt không dấu — nếu DB có unaccent, "trien khai" trả notes chứa "triển khai"; nếu không có unaccent, behavior tùy implementation (ghi rõ limitation).

**Filter kết hợp search:**

AC-008: Search `?q=keyword&authorId=<validUUID>&createdFrom=...&createdTo=...` → tất cả điều kiện AND, chỉ trả notes thỏa tất cả.
AC-009: Search `?q=keyword&noteType=in_meeting` → chỉ notes `in_meeting` chứa keyword.
AC-010: Search `?q=keyword&pinned=true` → chỉ pinned notes chứa keyword.

**Pagination + search:**

AC-011: Search `?q=keyword&page=1&limit=5` → page 1 với 5 results, `meta.total` đúng tổng số khớp.
AC-012: `limit > 100` → 400 `VALIDATION_ERROR`.

**Validation errors:**

AC-013: `?authorId=invalid-uuid` → 400 `VALIDATION_ERROR`.
AC-014: `?createdFrom` sai ISO format → 400 `VALIDATION_ERROR`.
AC-015: `?createdFrom > ?createdTo` → 400 `INVALID_DATE_RANGE`.

**Authorization:**

AC-016: Chưa đăng nhập → 401.
AC-017: Thiếu permission `meeting.note.read` → 403 `PERMISSION_DENIED`.
AC-018: User không phải participant → 403 `NOT_A_MEETING_PARTICIPANT`.
AC-019: Meeting không tồn tại → 404.
AC-020: Meeting status không phải `in_progress` hoặc `completed` → 422 `MEETING_STATUS_NOT_VIEWABLE`.

**Read-only:**

AC-021: Không có INSERT/UPDATE/DELETE nào được thực thi trong quá trình search.


**Clarification Resolutions (CR):**

AC-022: ?q=... vượt quá 255 ký tự → 400 VALIDATION_ERROR. (CR-003)
AC-023: Search với ?q=%meeting_ bằng ILIKE → wildcard được escape, tìm literal %meeting_ không phải pattern match. (CR-004)
AC-024: Co-host search ?q=keyword → thấy tất cả notes hợp lệ ngoại trừ private notes (isibility_level = 'private' AND uthor_id != currentUserId) của user khác. Host search với cùng keyword → thấy tất cả, bao gồm private notes của bất kỳ user nào. (CR-002)
---

## 8. API Contract Notes

### Endpoint

`GET /api/v1/meetings/{meetingId}/notes`
**Permission**: `meeting.note.read`
**Auth**: JWT required (`JwtAuthGuard`)
**Async**: No

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | UUID | Yes | ID cuộc họp cần search ghi chú |

### Query Parameters

| Field | Type | Required | Default | Rule |
|-------|------|----------|---------|------|
| `q` | string | No | — | Search keyword trên `content` — case-insensitive; hỗ trợ unaccent nếu DB có |
| `authorId` | UUID | No | — | Filter theo `author_id` |
| `createdFrom` | string (ISO 8601) | No | — | Filter `created_at >= :createdFrom` (inclusive); độc lập |
| `createdTo` | string (ISO 8601) | No | — | Filter `created_at <= :createdTo` (inclusive); độc lập |
| `noteType` | string | No | — | Filter theo `note_type`: `in_meeting` \| `private` \| `host_note` \| `system_note` |
| `visibility` | string | No | — | Filter thêm theo `visibility_level`: `private` \| `participants` \| `public_internal` \| `department` — áp SAU role filter |
| `pinned` | boolean | No | — | `true` = chỉ ghim; `false` = chỉ không ghim |
| `sort` | string | No | `timeline_asc` | `timeline_asc` \| `timeline_desc` |
| `page` | number | No | `1` | ≥ 1 |
| `limit` | number | No | `20` | 1..100 (trả 400 nếu > 100) |

> **Về tham số `tag`**: Không có cột `tag` trong DB v3.2 Compact. Filter theo loại ghi chú dùng `noteType` ở v1. Tham số `tag` sẽ được hỗ trợ trong Future Enhancement khi schema có cột riêng.

### Response 200 — Có kết quả

```json
{
  "success": true,
  "message": "Tìm kiếm ghi chú thành công",
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
    "total": 3,
    "totalPages": 1
  }
}
```

### Response 200 — Không có kết quả (Empty State)

```json
{
  "success": true,
  "message": "Không tìm thấy ghi chú nào khớp với điều kiện tìm kiếm của bạn.",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### Response 200 — Không có `?q=` (trả toàn bộ như UC-103)

```json
{
  "success": true,
  "message": "Lấy danh sách ghi chú thành công",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

---

## 9. Error Handling

| HTTP Status | Error Code | Mô tả chi tiết |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | `meetingId` không hợp lệ UUID; `authorId` không hợp lệ UUID; `from`/`to` không phải ISO datetime; `limit > 100`; `noteType`/`visibility`/`sort` ngoài allowlist |
| 400 | `INVALID_DATE_RANGE` | Cả `createdFrom` và `createdTo` đều được cung cấp nhưng `createdFrom > createdTo` |
| 401 | `UNAUTHORIZED` | Chưa xác thực / JWT không hợp lệ hoặc hết hạn |
| 403 | `PERMISSION_DENIED` | Thiếu permission `meeting.note.read` |
| 403 | `NOT_A_MEETING_PARTICIPANT` | User đã xác thực nhưng không phải Host hay Participant hợp lệ |
| 404 | `MEETING_NOT_FOUND` | `meetingId` không tồn tại hoặc `deleted_at IS NOT NULL` |
| 422 | `MEETING_STATUS_NOT_VIEWABLE` | Meeting ở trạng thái không cho phép xem ghi chú |
| 500 | `INTERNAL_ERROR` | Lỗi server không xác định |

**Error response format chuẩn:**
```json
{
  "success": false,
  "message": "...",
  "error": { "code": "ERROR_CODE", "details": {} },
  "timestamp": "2026-06-18T10:00:00+07:00",
  "path": "/api/v1/meetings/{meetingId}/notes"
}
```

---

## 10. Audit / Read-only Decision

Tính năng UC-IMM-11 là **read-only hoàn toàn**.

| Mục | Quyết định | Lý do |
|---|---|---|
| Ghi `audit_logs` | **Không** | GET đọc dữ liệu không tạo side effect có nghĩa nghiệp vụ |
| Ghi `meeting_events` | **Không** | Không thay đổi trạng thái meeting |
| Ghi `notifications` | **Không** | Search không kích hoạt thông báo |
| Database transaction | **Không cần ghi** | Chỉ SELECT; dùng read-only context |
| Side effect | **Không có** | Không thay đổi bất kỳ bảng nào |

---

## 11. Non-Functional Requirements

```text
NFR-001: THE system SHALL enforce strict visibility filtering — search results MUST NEVER include notes the user is not authorized to read, even when keyword matches.
NFR-002: Feature SHALL support Vietnamese accent-insensitive search at business level. WHERE PostgreSQL `unaccent` extension is available AND deployment infra permits, backend MAY utilize `unaccent(lower(content))` or equivalent full-text strategy. WHERE unavailable, THE system SHALL fallback to case-insensitive search via application-layer normalization or alternative strategy approved by project. Feature MUST NOT create `unaccent` extension or any index/extension via its own migration without explicit infra decision. (CR-001, CD-003)
NFR-003: THE system SHALL ensure `?q=` parameter is sanitized to prevent SQL injection — use parameterized queries or query builder, never string concatenation.
NFR-004: THE system SHALL return search results within acceptable response time under normal load; queries MUST leverage available indexes (e.g., GIN index on `content` for full-text search, B-tree on `meeting_id`).
NFR-005: THE system SHALL NOT execute any INSERT/UPDATE/DELETE statement during this operation.
NFR-006: THE system SHALL have unit test coverage for: search with keyword, search with Vietnamese unaccent (if applicable), empty keyword, no results, authorId filter, time range filter, visibility enforcement during search, pagination with search, error cases.
NFR-007: THE system SHALL return `content` already sanitized (no additional sanitization needed if sanitized at creation per UC-102 NFR-005).
NFR-008: IF implementation uses ILIKE fallback, THE system SHALL escape `%`, `_`, and `\` characters in the search keyword before passing to `ILIKE`. Use parameterized query with `ESCAPE '\'` syntax. (CR-004)
```

---

## 12. Implementation Notes

### 12.1 Search Strategy

Khi `?q=` được cung cấp, implementation có thể chọn một trong hai strategy tùy theo khả năng DB:

**Preferred — PostgreSQL Full-Text Search (GIN index):**
```sql
WHERE to_tsvector('simple', mn.content) @@ plainto_tsquery('simple', :q)
```
- `'simple'` configuration cho case-insensitive mà không stem.
- Nếu có extension `unaccent`, dùng `to_tsvector('simple', unaccent(mn.content)) @@ plainto_tsquery('simple', unaccent(:q))`.

**Fallback — `ILIKE`:**
```sql
WHERE mn.content ILIKE :escapedKeyword ESCAPE '\'
```
- Case-insensitive, không hỗ trợ unaccent.
- Không tận dụng được GIN index; performance kém hơn trên dữ liệu lớn.

### 12.2 Vietnamese Unaccent

- PostgreSQL extension `unaccent` cần được cài đặt riêng (`CREATE EXTENSION IF NOT EXISTS unaccent;`).
- Nếu chưa có migration tạo extension này, implementer cần tạo migration riêng trong scope implementation (không trong spec).
- Nếu không có unaccent, search chỉ hỗ trợ case-insensitive, không hỗ trợ Vietnamese accent-insensitive.

### 12.3 Index đề xuất

- `ix_meeting_notes_meeting_content_fts`: GIN index on `to_tsvector('simple', content)` — hỗ trợ full-text search.
- `ix_meeting_notes_author_id`: B-tree index on `author_id` — hỗ trợ filter `?authorId=`.
- Các index còn lại (`ix_meeting_notes_meeting`, `ix_meeting_notes_type`) nên đã tồn tại từ UC-102/UC-103.

### 12.4 Logic flow outline

```text
1. Validate JWT → get currentUserId
2. Validate meetingId (UUID, exists, deleted_at IS NULL, status in_progress/completed)
3. Validate actor is Host, Co-host or Participant (meeting_participants with participant_role IN ('host','co_host','participant') OR meetings.host_id). IF role is 'host' or 'co_host', treat as meeting operator (BR-004 visibility).
4. Build base query:
   - FROM meeting_notes WHERE meeting_id = :meetingId AND deleted_at IS NULL
   - IF Host: no visibility filter — thấy tất cả ghi chú hợp lệ kể cả private notes của người khác (BR-004)
   - IF Co-host: thấy tất cả ghi chú hợp lệ NGOẠI TRỪ private notes của user khác (`visibility_level = 'private'` AND `author_id != currentUserId`) (BR-020)
   - IF Participant: apply visibility filter (author_id = currentUserId OR visibility_level IN ('participants','public_internal') OR department check) (BR-005)
5. IF ?q= provided and non-empty:
   - Add search condition (full-text search or ILIKE) on content
6. Apply optional filters:
   - authorId, noteType, visibility, pinned, createdFrom, createdTo
7. Apply sort (created_at ASC/DESC)
8. Apply pagination (LIMIT/OFFSET)
9. Join users for author fullName
10. Return response (or empty state if no results)
```

---

## 13. Acceptance Criteria Traceability

| AC ID | Nội dung tóm tắt | FR / BR liên quan | Test case đề xuất |
|-------|------------------|-------------------|-------------------|
| AC-001 | Host search keyword khi `in_progress` → tất cả notes khớp | FR-007, BR-004, BR-007 | Service: Host search keyword |
| AC-002 | Participant search → chỉ shared + own notes | FR-007, BR-005, BR-016 | Service: Participant search visibility |
| AC-003 | Search không bypass visibility — private notes blocked | FR-011, BR-016, INVARIANT | Service: Search private notes blocked |
| AC-004 | `?q=` rỗng → behavior như UC-103 view | FR-010, BR-013 | Service: Empty keyword = view all |
| AC-005 | No results → 200 data=[], message search empty | FR-025, BR-012 | Service: No search results |
| AC-006 | Case-insensitive search | FR-007, BR-014 | Service: Case insensitive search |
| AC-007 | Vietnamese unaccent (nếu DB hỗ trợ) | FR-008, CD-003 | Service: Unaccent search (if applicable) |
| AC-008 | Search + filter authorId + createdFrom + createdTo → AND | FR-012, FR-013, FR-014, FR-015, BR-017 | Service: Combined search + filters |
| AC-009 | Search + noteType | FR-012, FR-017 | Service: Search + note type |
| AC-010 | Search + pinned | FR-012, FR-019 | Service: Search + pinned |
| AC-011 | Pagination với search | FR-021, FR-022 | Service: Pagination with search |
| AC-012 | limit > 100 | FR-021 | DTO: Limit exceeds max |
| AC-013 | authorId invalid UUID | FR-013 | DTO: Invalid authorId UUID |
| AC-014 | createdFrom sai định dạng | FR-014 | DTO: Invalid date format |
| AC-015 | createdFrom > createdTo | FR-016 | Service: Invalid date range |
| AC-016 | Chưa đăng nhập → 401 | FR-001 | Controller: Auth guard |
| AC-017 | Thiếu permission → 403 | FR-002 | Controller: Permission guard |
| AC-018 | Không phải participant → 403 | FR-006 | Service: Not a participant |
| AC-019 | Meeting không tồn tại → 404 | FR-004 | Service: Meeting not found |
| AC-020 | Meeting status sai → 422 | FR-005 | Service: Invalid meeting status |
| AC-021 | Read-only — không INSERT/UPDATE/DELETE | FR-026 | Integration: No write operations |
| AC-022 | Keyword q > 255 → 400 VALIDATION_ERROR | FR-007, BR-021, CR-003 | DTO: Keyword max length |
| AC-023 | ILIKE wildcard escape — literal search | FR-028, BR-022, CR-004 | Service: ILIKE escape wildcard |
| AC-024 | Co-host search visibility — thấy tất cả notes hợp lệ ngoại trừ private notes của user khác; Host thấy tất cả kể cả private notes | FR-006, BR-004, BR-006, BR-020, CR-002 | Service: Co-host vs Host search visibility |

---

## 14. Out of Scope

Các nội dung sau không thuộc UC-IMM-11:

- **POST tạo ghi chú** — thuộc UC-IMM-09 / UC-102.
- **PATCH cập nhật ghi chú** — UC riêng.
- **DELETE ghi chú (soft delete)** — UC riêng.
- **Share/unshare host_note** — UC riêng.
- **Pin/unpin ghi chú** — UC riêng.
- **Realtime WebSocket** cho search — không broadcast; dữ liệu lấy qua API request.
- **Export danh sách ghi chú** thành PDF/DOCX — thuộc tính năng export/minutes.
- **Tag phân loại chi tiết** (Quyết định/Hành động/Ý tưởng) — không có cột `note_tag` trong DB v3.2 Compact; filter hiện tại dùng `noteType` làm proxy. Cần migration thêm cột và use case riêng.
- **Search cross-entity** (search đồng thời trên `meeting_notes`, `meeting_minutes`, `transcripts`) — nằm ngoài scope UC-IMM-11.
- **AI summary** của ghi chú.
- **Search trên ghi chú pre-meeting** hoặc của meeting `scheduled`.
- **External Participant** search ghi chú.
- **Ghi audit_logs** cho search — read-only, không ghi log.
- **Enrich source event** (`includeSourceEvent`) — thuộc UC-IMM-10, không lặp lại trong search spec.

**Future Enhancements (không implement trong v1):**
- Filter theo tag/category riêng (yêu cầu thêm cột `note_tag` vào `meeting_notes` qua migration).
- Sort tùy chỉnh đa chiều (ví dụ: relevance score sort cho search results).
- Highlight matched keyword trong response content (snippet generation).
- Search suggestions / auto-complete cho tag và author.
- Cross-entity unified search.

### OOS Guardrails

```text
OOS-001: THE system SHALL NOT create new database tables or columns as part of this feature.
OOS-002: THE system SHALL NOT implement AI/nlp/natural language search in this feature.
OOS-003: THE system SHALL NOT add `tag` column to `meeting_notes` — tag filter uses `noteType` as proxy only.
OOS-004: THE system SHALL NOT record audit logs for search operations.
```

