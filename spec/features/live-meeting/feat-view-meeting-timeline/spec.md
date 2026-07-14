# Feature Specification: Xem timeline cuộc họp (View meeting timeline)

- **Feature ID**: UC-99
- **Feature Name**: Xem timeline cuộc họp
- **Module / Domain**: In-Meeting Management (`live-meeting`)
- **Created Date**: 2026-07-13
- **Status**: Draft
- **Related UC**: UC-105
- **Source Documents**:
  - Use Case: UC-99 Xem timeline cuộc họp
  - Database v3.2 Compact — bảng `meeting_events`, `attendance_events`, `meeting_notes`, `meeting_participants`, `meetings`
  - CLAUDE.md / AGENTS.md
  - Khảo sát code hiện trạng: `src/modules/live-meeting`, `src/modules/meetings`, `src/modules/attendance`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới spec cho UC-99. Xác định **[Partial]** — hạ tầng dữ liệu (3 bảng nguồn) đầy đủ nhưng **thiếu endpoint gộp timeline**. | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Partial]** — dữ liệu 5 loại sự kiện **đã được ghi** vào 3 bảng nguồn; pattern kiểm quyền theo quan hệ meeting **đã có** (endpoint notes). Nhưng **CHƯA có endpoint gộp** các nguồn thành 1 timeline theo thời gian.

### 0.1. Đã có (hạ tầng — tái dùng)

| Nguồn sự kiện | Bảng / EventType | Endpoint đọc hiện có? |
| :--- | :--- | :--- |
| start / end / warning / status / extension… | `meeting_events` — `MeetingEventType`: `meeting_started`, `meeting_ended`, `warning_sent`, `status_changed`, `extension_*`, `attendance_checkin_alert_sent`… ([meeting-event.entity.ts:11-30](../../../../src/modules/meetings/entities/meeting-event.entity.ts#L11)) | ❌ **KHÔNG có endpoint đọc** (bảng hiện chỉ được GHI, dạng audit sự kiện) |
| check-in / check-out | `attendance_events` — `event_type` ∈ {`check_in`,`check_out`,`face_detected`}, `event_time`, `user_id` | ⚠️ Có `GET /meetings/:id/attendance` (bản ghi điểm danh) nhưng **không** phải stream event theo thời gian |
| note | `meeting_notes` — `note_type` (in_meeting/private/host_note/system_note), `visibility`, `created_at` | ✅ `GET /meetings/:meetingId/notes` (perm `meeting.note.read`) — **CHỈ notes** |

### 0.2. Làm rõ `sort=timeline_asc/desc`

- `sort=timeline_asc/desc` **KHÔNG** phải endpoint timeline gộp. Đó chỉ là **tùy chọn sắp xếp của danh sách notes** `GET /meetings/:meetingId/notes` ([live-meeting.controller.ts:609-680](../../../../src/modules/live-meeting/controllers/live-meeting.controller.ts#L609)).

### 0.3. Pattern kiểm quyền theo quan hệ meeting (ĐÃ CÓ — tái dùng)

- Endpoint notes trả `403 NOT_A_MEETING_PARTICIPANT` nếu người gọi không phải participant/host của cuộc họp ([live-meeting.controller.ts:687-690](../../../../src/modules/live-meeting/controllers/live-meeting.controller.ts#L687)). ⇒ Đã có tiền lệ "quyền xem theo QUAN HỆ với meeting" (khác các UC account chỉ dựa role toàn cục). UC-99 tái dùng pattern này.

### 0.4. Gap thật (Expected Output vs hiện trạng)

Expected Output UC-99: "Hiển thị các sự kiện **start/end/check-in/note/warning** theo thời gian."

- ✅ Cả 5 loại **đều có dữ liệu** trong 3 bảng nguồn (`meeting_events` cho start/end/warning; `attendance_events` cho check-in; `meeting_notes` cho note).
- ❌ **KHÔNG có endpoint nào GỘP** 3 nguồn này thành 1 danh sách sắp theo thời gian. `meeting_events` thậm chí **chưa có endpoint đọc**.
- ⇒ UC-99 = **[Partial]**: cần **endpoint timeline gộp** (đọc thuần túy) — hạ tầng dữ liệu đã sẵn.

---

## 1. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-99 |
| **Use Case Name** | Xem timeline cuộc họp |
| **Module** | In-Meeting Management (`live-meeting`) |
| **Primary Actor** | Internal User = **Host / Participant** của chính cuộc họp (quyền theo **quan hệ**, không phải admin toàn cục) |
| **Trigger** | Người có quyền (host/participant) mở timeline của cuộc họp |
| **Expected Output** | Danh sách sự kiện start/end/check-in/note/warning sắp theo thời gian (asc/desc), phân trang |
| **Pre-condition** | Phiên họp (`meetings`) tồn tại |
| **Related** | UC-105 |

---

## 2. Actor & Trigger

- **Primary Actor**: Internal User là **Host** (`meetings.host_id`/`organizer_id`) hoặc **Participant** (`meeting_participants.user_id`) của cuộc họp đó. Đây là điểm khác các UC quản trị tài khoản (UC-08→14) vốn dựa role toàn cục (SYSTEM_ADMIN/BUSINESS_ADMIN); UC-99 dựa **quan hệ với meeting**.
- **Trigger**: mở màn hình timeline của một cuộc họp cụ thể (`meetingId`).
- **Secondary Actor**: không có (READ đồng bộ).

---

## 3. Endpoint (đề xuất mới — chờ chốt)

Theo convention hiện có (notes = `GET /meetings/:meetingId/notes`), đề xuất:

```text
GET /api/v1/meetings/:meetingId/timeline
    ?from=<iso>&to=<iso>&types=<csv>&sort=asc|desc&page=<n>&limit=<m>
```

- Sub-resource `timeline` của `meetings/:meetingId`, nhất quán style notes/attendance.
- *(Phương án thay thế: `GET /api/v1/live-meetings/:meetingId/timeline` — cùng module live-meeting; chờ chốt.)*
- Response chuẩn module: `{ success, message, data: TimelineItem[], meta{page,limit,total,totalPages} }`.

---

## 4. Nguồn dữ liệu timeline & shape item

Gộp (UNION theo thời gian) từ **3 bảng nguồn**, mỗi bản ghi chuẩn hóa thành 1 `TimelineItem`:

| Category | Nguồn | Lọc/loại | Trường ánh xạ |
| :--- | :--- | :--- | :--- |
| `meeting_event` (start/end/warning/status/extension…) | `meeting_events` | `event_type` (Expected Output tối thiểu: `meeting_started`, `meeting_ended`, `warning_sent`) | `time=event_time`, `type=event_type`, `actor=actor_user_id`, `detail=description`/metadata |
| `attendance` (check-in/out) | `attendance_events` | `event_type` (`check_in`; tùy chọn `check_out`/`face_detected`) | `time=event_time`, `type=event_type`, `actor=user_id` |
| `note` | `meeting_notes` | theo `visibility`/`note_type` (§6) | `time=created_at`, `type='note'`, `actor=author`, `detail=content` |

**Shape đề xuất** (chờ chốt tập trường):
```json
{
  "time": "2026-07-13T09:00:00Z",
  "category": "meeting_event | attendance | note",
  "type": "meeting_started | check_in | warning_sent | note | ...",
  "actorUserId": "uuid|null",
  "actorName": "string|null",
  "detail": "string|null",
  "refId": "uuid (id bản ghi nguồn)"
}
```

> **Điểm cần chốt**: tập `event_type` của `meeting_events` đưa vào timeline — Expected Output liệt kê 5 loại; có mở rộng thêm `status_changed`/`extension_*`/`attendance_checkin_alert_sent` không (§7).

---

## 5. Sắp xếp & Phân trang

- **Sort** theo thời gian (`time`) `asc`/`desc` (mặc định `asc` hoặc `desc` — chờ chốt).
- **Phân trang** `page`/`limit` (default 1/20, max 100), trả `total`+`totalPages`.
- ⚠️ **Lưu ý kỹ thuật (không thuộc spec chi tiết)**: gộp 3 bảng + sort + phân trang cần UNION (hoặc gộp ở tầng app) — cần đảm bảo `total` và thứ tự đúng khi trộn nhiều nguồn. Nêu để cảnh báo, không quyết ở spec.

---

## 6. Quyền xem (theo quan hệ meeting — điểm khác biệt)

- Người gọi phải là **Host hoặc Participant** của `meetingId` (tái dùng pattern `NOT_A_MEETING_PARTICIPANT` như endpoint notes).
- Cơ chế kiểm (tái dùng, chờ xác nhận method thật): người gọi ∈ `meeting_participants.user_id` của meeting **hoặc** = `meetings.organizer_id`/`host_id`. Nếu không → `403 NOT_A_MEETING_PARTICIPANT`.
- **Permission gate**: chờ chốt — (a) tái dùng permission hiện có (vd `meeting.note.read`), hoặc (b) permission mới `meeting.timeline.read`. Đề xuất permission riêng để tách ngữ nghĩa; chờ chốt.
- ⚠️ **Note visibility (quan trọng)**: `meeting_notes` có `visibility` (private/participants/public_internal/department) và `note_type` (gồm `private`/`host_note`). Timeline **phải tôn trọng visibility** — một Participant thường **không** được thấy note `private`/`host_note` của người khác. Endpoint notes hiện đã lọc theo visibility; timeline **phải áp cùng quy tắc** khi trộn note vào. **Điểm cần chốt/bắt buộc tuân thủ.**

---

## 7. Main Flow (happy path)

1. Host/Participant gọi `GET /api/v1/meetings/:meetingId/timeline?...`.
2. `JwtAuthGuard` + `PermissionsGuard` (permission gate).
3. Validate `meetingId` UUID; `from ≤ to`; `sort`, `page/limit`.
4. Load meeting → không tồn tại: `404`.
5. Kiểm quan hệ: người gọi là host/participant → nếu không: `403 NOT_A_MEETING_PARTICIPANT`.
6. Truy vấn 3 nguồn (áp filter `from/to`, `types`, **và note-visibility theo người gọi**), gộp theo `time`, sort, phân trang.
7. Chuẩn hóa `TimelineItem[]` (resolve `actorName` từ `users`), trả `{ data, meta }`. **Không** ghi mutation.

---

## 8. Exception / Alternative Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | Unauthorized |
| Thiếu permission gate | 403 | PERMISSION_DENIED |
| Không phải host/participant của meeting | 403 | NOT_A_MEETING_PARTICIPANT |
| `meetingId` sai UUID / `from>to` | 400 | VALIDATION_ERROR / INVALID_DATE_RANGE |
| Meeting không tồn tại | 404 | MEETING_NOT_FOUND |
| Không có sự kiện | 200 | `data: []`, `meta.total: 0` |
| Meeting ở trạng thái không cho xem (nếu áp) | 422 | (tùy chính sách — như notes) |

---

## 9. Data touched (READ-only)

| Bảng | Thao tác | Ghi chú |
| :--- | :--- | :--- |
| `meeting_events` | READ | start/end/warning/status/extension |
| `attendance_events` | READ | check-in/out |
| `meeting_notes` | READ (lọc visibility) | note |
| `meetings`, `meeting_participants` | READ | kiểm quyền host/participant |
| `users` | READ | resolve actorName |

- **KHÔNG mutation, KHÔNG migration/index** (nếu dữ liệu lớn cân nhắc index `meeting_id, event_time` — đề xuất tương lai, không thuộc UC-99).

---

## 10. Giả định & điểm cần chốt

1. **[Endpoint]** `GET /meetings/:meetingId/timeline` (đề xuất) vs `/live-meetings/:meetingId/timeline`.
2. **[Tập event_type]** meeting_events đưa vào timeline: tối thiểu start/end/warning; có thêm status_changed/extension_*/checkin_alert không.
3. **[Attendance]** chỉ `check_in` hay cả `check_out`/`face_detected`.
4. **[Note visibility]** BẮT BUỘC tôn trọng `visibility`/`note_type` khi trộn note (không lộ private/host_note cho participant thường). Cần chốt quy tắc chính xác (tái dùng logic notes hiện có).
5. **[Permission]** tái dùng `meeting.note.read` hay tạo `meeting.timeline.read`.
6. **[Sort mặc định + phân trang]** asc/desc default; cách trộn 3 nguồn + total.
7. **[Actor]** Host/Participant — xác nhận method kiểm quan hệ thật (reuse của notes service).

---

## 11. Trạng thái kết luận

**[Partial]** — hạ tầng đủ, thiếu endpoint gộp.

- **Đã có (tái dùng, KHÔNG làm lại)**: dữ liệu 5 loại sự kiện đã ghi (`meeting_events`, `attendance_events`, `meeting_notes`); endpoint notes (`GET /meetings/:id/notes`) với sort timeline + lọc visibility; pattern quyền theo quan hệ meeting (`NOT_A_MEETING_PARTICIPANT`).
- **Cần làm (gap)**:
  1. Endpoint **mới** `GET /meetings/:meetingId/timeline` (READ-only) — **gộp** `meeting_events` (start/end/warning/status…) + `attendance_events` (check-in) + `meeting_notes` (note) thành `TimelineItem[]` sắp theo thời gian, phân trang.
  2. **Kiểm quyền theo quan hệ** Host/Participant (reuse pattern notes) + permission gate.
  3. **Tôn trọng note-visibility** khi trộn note (không lộ private/host_note).
  4. (Lưu ý) `meeting_events` hiện **chưa có** đường đọc — timeline sẽ là nơi đầu tiên expose nó (chỉ READ).
- **Không đụng UC khác / không mutation**: UC-99 chỉ đọc + gộp; không tạo/sửa sự kiện; không migration/seed. Ghi sự kiện là trách nhiệm các UC khác (start/end/warning/attendance/note).
- **Chặn trước khi làm**: chốt 7 điểm §10 (đặc biệt: endpoint, tập event_type, note-visibility bắt buộc, permission, cơ chế kiểm quan hệ).
