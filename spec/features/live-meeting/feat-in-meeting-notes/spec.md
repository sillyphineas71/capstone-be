# Feature Specification: Thêm ghi chú trong cuộc họp (In-Meeting Notes)

- **Feature ID**: UC-IMM-09 / UC-102
- **Feature Name**: Thêm ghi chú trong cuộc họp
- **Module / Domain**: live-meeting
- **Created Date**: 2026-06-17
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables) — bảng `meeting_notes`
  - API_CONTRACT_v1.0_with_system_roles.md (UC-102, UC-103, UC-104)
  - AGENTS.md - Backend Agent Guide v1.1
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Cập nhật giải quyết dứt điểm NEEDS CLARIFICATION (auto-save draft client, visibility_level, permission, gỡ WebSocket, thêm XSS sanitize) | Toàn bộ file |
| 2026-06-17 | Tạo spec lần đầu cho UC-IMM-09 / UC-102 Thêm ghi chú trong cuộc họp | Toàn bộ file |

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

Tính năng UC-IMM-09 thuộc nhóm In-Meeting Management, module `live-meeting`.

Trong quy trình meeting lifecycle, người dùng có quyền cần khả năng ghi chú nhanh trong khi cuộc họp đang diễn ra — ví dụ quyết định được đưa ra, hành động cần theo dõi, hay ý tưởng phát sinh — mà không cần rời khỏi giao diện điều khiển cuộc họp. Trong khi soạn thảo, nội dung được lưu nháp cục bộ tại client (draft). Khi hoàn tất, ghi chú được gửi một lần duy nhất lên hệ thống với timestamp sinh tự động.

Feature này xây dựng trên bối cảnh đã thống nhất từ UC-IMM-02 và UC-IMM-03: tiền đề cuộc họp đang ở trạng thái `in_progress`. Note: Tính năng ghi chú sẽ không dùng WebSocket để broadcast realtime mà lấy dữ liệu qua cơ chế polling/fetch.

### 1.2 Mục tiêu

- Cho phép người dùng (Host và Internal Participant có quyền) tạo ghi chú văn bản trong khi meeting đang `in_progress`.
- Timestamp ghi chú (`created_at`) do hệ thống sinh tự động — không được gửi hoặc chỉnh sửa giá trị này (BR-002).
- Kiểm soát khả năng đọc theo `visibility_level`: `host_note` và `private` mặc định chỉ người tạo thấy (`private`), `in_meeting` mặc định những người tham gia thấy (`participants`).
- Hỗ trợ ghim (`pinned`) ghi chú quan trọng.
- Auto-save draft cục bộ phía client: chỉ gọi API POST lưu một lần duy nhất khi người dùng bấm Lưu, không có trạng thái draft phía backend.
- Sau cuộc họp, ghi chú phù hợp có thể được đính kèm vào email minutes (hành động thuộc module `minutes`, ngoài scope UC-102).

### 1.3 Giả định

- Meeting đang ở trạng thái `in_progress` (liên kết context với UC-IMM-01 — Bắt đầu phiên họp).
- Actor đã đăng nhập, có JWT token hợp lệ và permission `meeting.note.create` (kể cả Host lẫn Internal Participant).
- `created_at` là server time; client không được gửi trường này trong request body.
- Auto-save là chức năng lưu nháp ở LocalStorage phía client; backend chỉ nhận 1 POST cuối cùng để tạo note, không cập nhật liên tục lên DB.
- Soft delete: xóa ghi chú dùng `deleted_at`, không xóa vật lý.

---

## 2. Actor & Roles

### Primary Actor

- **Host** (`meeting_participants.is_host = true`): Chủ trì cuộc họp. Kịch bản chính sử dụng tính năng. Được phép tạo tất cả `note_type` hợp lệ: `in_meeting`, `host_note`, `private`.

### Secondary Actor

- **Internal Participant**: Mọi participant thuộc nội bộ (có Role như `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) được phân quyền `meeting.note.create`. Được phép gọi POST API tạo note với loại `in_meeting` hoặc `private`. Không được phép tạo `host_note`.

### Không thuộc scope tạo note qua UC-102

- `system_note`: chỉ do internal system tạo, có `source_event_id` không null.
- External participant (không có tài khoản trong hệ thống).

---

## 3. Business Rules

BR-001: Meeting phải đang ở trạng thái `in_progress` khi tạo ghi chú.
BR-002: `created_at` do server sinh (`DEFAULT now()`). Client không được gửi trường `createdAt`/`created_at` trong request body; nếu gửi, hệ thống bỏ qua (whitelist DTO).
BR-003: `note_type` phải thuộc allowlist: `in_meeting`, `private`, `host_note`. Giá trị `system_note` bị cấm với actor người dùng.
BR-004: Chỉ Host (`meeting_participants.is_host = true`) được tạo `note_type = host_note`.
BR-005: `host_note` mặc định `visibility_level = 'private'` nếu client không gửi giá trị tường minh (khi Host chia sẻ, giá trị này sẽ đổi thành `participants` ở một tính năng PATCH nằm ngoài scope).
BR-006: `in_meeting` mặc định `visibility_level = 'participants'` nếu client không gửi giá trị tường minh.
BR-007: `private` mặc định `visibility_level = 'private'` nếu client không gửi giá trị tường minh.
BR-008: Khi đọc danh sách ghi chú (UC-103/104), hệ thống lọc nghiêm ngặt theo `visibility_level` dựa trên identity của user hiện tại (ví dụ: `private` chỉ hiện với tác giả).
BR-009: `pinned = true` chỉ được set bởi Host. Mặc định `false`.
BR-010: Ghi chú với `deleted_at IS NOT NULL` không được trả về trong bất kỳ GET response nào.
BR-011: Auto-save là chức năng lưu nháp cục bộ (draft) ở client. Backend xử lý request POST như một hành động dứt điểm duy nhất (người dùng bấm Lưu), không hỗ trợ trạng thái draft phía server.
BR-012: Ghi chú sau cuộc họp kết thúc có thể được tham chiếu bởi module `minutes` để đính kèm vào email — hành động này nằm ngoài scope UC-102.

---

## 4. Functional Requirements

### 4.1 Tạo ghi chú (UC-102)

FR-001: THE system SHALL cho phép actor có permission `meeting.note.create` tạo ghi chú cho meeting đang `in_progress`.
FR-002: THE system SHALL validate meeting tồn tại và có `status = in_progress` trước khi tạo.
FR-003: THE system SHALL set `author_id = currentUserId` từ JWT token, không nhận `authorId` từ request body.
FR-004: THE system SHALL set `created_at = server_now()` tự động và bỏ qua bất kỳ giá trị thời gian nào client gửi lên.
FR-005: IF `note_type = system_note` được gửi từ user actor, THEN THE system SHALL reject request với lỗi phù hợp.
FR-006: WHEN `note_type = host_note` được gửi, THE system SHALL validate actor là Host của meeting; IF không phải Host, THEN reject với lỗi `NOTE_HOST_ONLY`.
FR-007: THE system SHALL apply default `visibility_level` theo BR-005, BR-006, BR-007 khi client không gửi giá trị tường minh.
FR-008: IF client gửi `visibility_level` tường minh, THE system SHALL validate giá trị thuộc allowlist: `['private', 'participants', 'department', 'public_internal']`.
FR-009: THE system SHALL validate `content` không rỗng và không chỉ là whitespace.
FR-010: THE system SHALL persist ghi chú ngay khi nhận request (synchronous).
FR-011: WHEN ghi chú được tạo thành công, THE system SHALL trả response 201 với data đầy đủ theo API contract UC-102.

### 4.2 Xem ghi chú (UC-103)

FR-013: THE system SHALL cho phép actor có permission `meeting.note.read` lấy danh sách ghi chú của meeting.
FR-014: THE system SHALL lọc ghi chú theo `visibility_level` dựa trên identity và role của user hiện tại trong meeting (BR-008).
FR-015: THE system SHALL hỗ trợ filter query `?noteType`, `?pinned`, `?page`, `?limit`.
FR-016: THE system SHALL không trả ghi chú có `deleted_at IS NOT NULL` (BR-010).

### 4.3 Tìm kiếm ghi chú (UC-104)

FR-017: THE system SHALL hỗ trợ full-text search qua `?q=<keyword>` trên `meeting_notes.content` sử dụng GIN index.
FR-018: THE system SHALL kết hợp full-text search với visibility filter — không trả ghi chú user không có quyền đọc.

---

## 5. Data Model Impact

Không thêm bảng mới. Không thêm column mới ngoài DB baseline v3.2 Compact trong UC-102. Tính năng Tag phân loại (Quyết định/Hành động/Ý tưởng) được xếp vào Out of Scope để đảm bảo không đổi schema.

### 5.1 Bảng chính: `meeting_notes`

| Column | Type | Vai trò trong UC-102 |
|---|---|---|
| `id` | `uuid PK` | Khóa chính ghi chú |
| `meeting_id` | `uuid FK → meetings.id` | Cuộc họp liên quan |
| `author_id` | `uuid FK → users.id` | = `currentUserId` từ JWT |
| `note_type` | `varchar(30)` | `in_meeting` / `private` / `host_note` |
| `content` | `text NOT NULL` | Nội dung ghi chú |
| `pinned` | `boolean DEFAULT false` | Ghim ghi chú quan trọng |
| `visibility_level` | `varchar(30) DEFAULT 'participants'` | Ai được xem (BR-005, BR-006, BR-007) |
| `source_event_id` | `uuid FK → meeting_events.id` | NULL với ghi chú user tạo thủ công |
| `created_at` | `timestamptz DEFAULT now()` | Timestamp do server sinh — không nhận từ client |
| `updated_at` | `timestamptz` | Auto-update nếu có PATCH |
| `deleted_at` | `timestamptz` | Soft delete |

### 5.2 Bảng liên quan

| Bảng | Mối quan hệ |
|---|---|
| `meetings` | Check `status = in_progress` (BR-001) |
| `meeting_participants` | Validate `is_host = true` cho BR-004, BR-009 |
| `users` | `author_id` → `users.id` |
| `meeting_events` | `source_event_id` tùy chọn (NULL với manual note) |

---

## 6. Error Handling / Edge Cases

| HTTP Status | Error Code | Mô tả |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | `content` rỗng; `visibilityLevel` không thuộc allowlist |
| 401 | `UNAUTHORIZED` | Chưa đăng nhập |
| 403 | `PERMISSION_DENIED` | Thiếu permission `meeting.note.create` |
| 403 | `NOTE_HOST_ONLY` | Non-host gửi `noteType = host_note` |
| 404 | `MEETING_NOT_FOUND` | `meetingId` không tồn tại |
| 409 | `MEETING_NOT_IN_PROGRESS` | Meeting không ở trạng thái `in_progress` |
| 422 | `NOTE_SYSTEM_TYPE_FORBIDDEN` | Client gửi `noteType = system_note` |
| 500 | `INTERNAL_ERROR` | Lỗi server không xác định |

**Edge Cases (EC):**
- EC-001: Người dùng soạn ghi chú nháp trên client, nhưng lúc nhấn Lưu thì Host đã bấm "End Meeting" (chuyển trạng thái sang `completed`). Hệ thống dứt khoát trả `409 MEETING_NOT_IN_PROGRESS` (không có grace period). Client sẽ chịu trách nhiệm giữ draft cục bộ và báo lỗi cho người dùng.

---

## 7. Acceptance Criteria

**Primary flow — Tạo ghi chú:**

AC-001: Host tạo ghi chú `in_meeting` khi meeting `in_progress` → hệ thống persist ngay, trả 201 với `createdAt` do server sinh.
AC-002: `createdAt` trong response không bằng bất kỳ giá trị thời gian nào được gửi từ client.
AC-003: Host tạo `host_note` không gửi `visibilityLevel` → response có `visibilityLevel = 'private'`; ghi chú không xuất hiện trong GET list của participant thường.
AC-004: Host tạo `in_meeting` không gửi `visibilityLevel` → response có `visibilityLevel = 'participants'`.

**Alternative flow — Phân loại:**

AC-005: Người dùng tạo note với `noteType = private` → `visibilityLevel` mặc định `private`; chỉ người tạo (author) thấy trong GET list.

**Guard / validation:**

AC-007: Non-host gửi `noteType = host_note` → hệ thống trả 403 `NOTE_HOST_ONLY`.
AC-008: Bất kỳ actor nào gửi `noteType = system_note` → hệ thống trả 422 `NOTE_SYSTEM_TYPE_FORBIDDEN`.
AC-009: Meeting ở trạng thái `completed` hoặc `cancelled` → tạo ghi chú trả 409 `MEETING_NOT_IN_PROGRESS`.
AC-010: `content` rỗng hoặc chỉ whitespace → trả 400 `VALIDATION_ERROR`.

**Xem / tìm kiếm:**

AC-011: GET với `?noteType=in_meeting&pinned=true` → chỉ trả ghi chú phù hợp visibility của user hiện tại.
AC-012: GET với `?q=triển khai` → full-text search, không trả ghi chú user không có quyền đọc.
AC-013: Ghi chú có `deleted_at IS NOT NULL` không xuất hiện trong GET response.

**Edge Cases:**

AC-014: Gửi POST tạo ghi chú khi meeting vừa được cập nhật thành `completed` → hệ thống từ chối lưu và trả 409 `MEETING_NOT_IN_PROGRESS`.

---

## 8. API Contract

### UC-102 — Tạo ghi chú

`POST /api/v1/meetings/{meetingId}/notes`
**Permission:** `meeting.note.create`

**Request Body:**
```json
{
  "noteType": "in_meeting",
  "content": "Quyết định: Triển khai module X vào Q3",
  "pinned": false,
  "visibilityLevel": "participants"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "meetingId": "uuid",
    "noteType": "in_meeting",
    "content": "Quyết định: Triển khai module X vào Q3",
    "pinned": false,
    "visibilityLevel": "participants",
    "author": { "id": "uuid", "fullName": "Nguyễn Văn A" },
    "createdAt": "2026-06-17T09:45:00+07:00"
  }
}
```

### UC-103 — Xem ghi chú

`GET /api/v1/meetings/{meetingId}/notes?noteType=in_meeting&pinned=true&page=1&limit=20`
**Permission:** `meeting.note.read`

**Response 200:** Danh sách `meeting_notes` lọc theo `visibility_level` của user hiện tại, có pagination meta.

### UC-104 — Tìm kiếm ghi chú

`GET /api/v1/meetings/{meetingId}/notes?q=triển khai&page=1&limit=20`
**Permission:** `meeting.note.read`

- Full-text search dùng GIN index trên `meeting_notes.content`.
- Kết hợp với visibility filter (FR-018).

---

## 9. Non-Functional Requirements

NFR-001: THE system SHALL persist mỗi ghi chú synchronously và trả response 201 trong điều kiện tải bình thường.
NFR-002: THE system SHALL enforce visibility filter nghiêm ngặt; không để lộ ghi chú `private` ra ngoài actor không có quyền.
NFR-003: IF client mất kết nối sau khi request đã được nhận thành công, THE system SHALL đảm bảo ghi chú đã persist (không rollback nếu transaction đã commit).
NFR-004: THE system SHALL có unit test cho: create note (happy path), host_note restriction, system_note forbidden, meeting not in_progress guard, visibility filter khi GET.
NFR-005: THE system SHALL tự động sanitize trường `content` (chống XSS) trước khi lưu vào DB và/hoặc khi trả về API, đảm bảo lưu Markdown hoặc plain text an toàn, loại bỏ các tag HTML nguy hiểm.

---

## 10. Out of Scope

Các nội dung sau không thuộc UC-IMM-09 / UC-102:

- PATCH (cập nhật nội dung ghi chú sau khi tạo) — thuộc UC riêng.
- DELETE ghi chú (soft delete) — thuộc UC riêng.
- "Share" `host_note` (chuyển `visibility_level = 'participants'`) — là thao tác PATCH, thuộc UC riêng.
- Đính kèm ghi chú vào email minutes — thuộc module `minutes` / `notifications`.
- Tag phân loại (Quyết định/Hành động/Ý tưởng) — không nằm trong scope v1 do cấu trúc DB chưa có cột `note_tag` (cần future enhancement).
- Tạo `system_note` — do internal system tạo, không qua endpoint này.
- Đồng bộ ghi chú với AI transcript hoặc AI summary.
- Export danh sách ghi chú thành PDF/DOCX — thuộc tính năng export/minutes.
- Ghi chú pre-meeting hoặc post-meeting — ngoài lifecycle `in_progress`.
- Pin/unpin ghi chú sau khi đã tạo — thuộc PATCH, UC riêng.
- Realtime WebSocket cho note — note được lấy qua cơ chế polling/fetch (GET /notes) sau khi tạo hoặc khi mở panel, không broadcast.
