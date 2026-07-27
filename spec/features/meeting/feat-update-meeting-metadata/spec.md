# BE-03 — PATCH /api/v1/meetings/{meetingId} (Cập nhật thông tin cơ bản)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo spec lần đầu cho BE-03 (endpoint update meeting metadata còn thiếu — chỉ có `PATCH meetings/:meetingId/time` và `PATCH meetings/:meetingId/room`, không có PATCH 2-segment cho `title`/`description`). | Toàn bộ file |

---

## 1. Bối cảnh

`meetings.controller.ts` có các endpoint chuyên trách để sửa thời gian (`PATCH .../time`) và phòng (`PATCH .../room`), nhưng không có cách nào để sửa `title`/`description` của một meeting đã tạo. Đây là khoảng trống BE-03.

## 2. Phạm vi — CỐ Ý HẸP

Endpoint này **chỉ nhận `title` và `description`**. Các trường khác (thời gian, phòng, người tham dự, agenda, ghi hình, `organizer`) đi qua endpoint chuyên trách sẵn có:

| Trường | Endpoint |
| :-- | :-- |
| `roomId` | `PATCH /meetings/{meetingId}/room` |
| `startTime`/`endTime` | `PATCH /meetings/{meetingId}/time` |
| `participantIds` | `POST/DELETE /meetings/{meetingId}/participants/...` |
| `recordingEnabled` | Thuộc `recording-configs` (module `recording`) |
| `agenda` | `PUT/PATCH/DELETE /meetings/{meetingId}/agendas/...` |
| `organizer` | Không có endpoint đổi organizer trong scope hiện tại — ngoài phạm vi đợt này |

**⚠️ Cảnh báo cho FE:** `forbidNonWhitelisted: true` sẽ trả **400** nếu body chứa bất kỳ field nào ngoài `title`/`description`. FE hiện đang gửi payload gộp (`roomId`, `scheduledStart/End`, `participantIds`, `recordingEnabled`, `agenda`, `startTime/endTime`, `organizer` — xem `manager/MeetingDetail.jsx:264-272`, `bussinessAdmin/MeetingManagement.jsx:135-148`) — **phải tách call** trước khi FE tích hợp endpoint mới này.

## 3. Functional Requirements (EARS)

```text
FR-001: THE system SHALL cung cấp PATCH /api/v1/meetings/{meetingId} yêu cầu permission meeting.update.own, chỉ chấp nhận body {title?, description?}.

FR-002: IF body không chứa cả title lẫn description (cả hai đều undefined), THEN THE system SHALL trả 400 EMPTY_UPDATE_PAYLOAD.

FR-003: THE system SHALL cho phép chỉ organizer hoặc host của cuộc họp thực hiện; nếu không, trả 403 FORBIDDEN.

FR-004: IF meeting.status là cancelled hoặc completed, THEN THE system SHALL trả 409 INVALID_MEETING_STATUS (không cho sửa cuộc họp đã kết thúc vòng đời).

FR-005: THE system SHALL cập nhật chỉ (các) field được gửi — field không gửi giữ nguyên giá trị cũ (partial update, không phải full replace).

FR-006: THE system SHALL ghi meeting_events (event_type = metadata_updated) trong cùng transaction với UPDATE meetings, theo §17 CLAUDE.md.

FR-007: IF meeting không tồn tại hoặc đã bị xóa mềm (deleted_at), THEN THE system SHALL trả 404 MEETING_NOT_FOUND.
```

## 4. Acceptance Criteria

- AC-001: Given organizer gửi `{title: "..."}`, When gọi endpoint, Then chỉ `title` đổi, `description` giữ nguyên, trả 200.
- AC-002: Given host (không phải organizer) gửi request hợp lệ, When gọi endpoint, Then vẫn thành công (host có quyền như organizer, mirror `meeting.cancel.own`).
- AC-003: Given body rỗng `{}`, When gọi endpoint, Then trả 400 `EMPTY_UPDATE_PAYLOAD`.
- AC-004: Given body chứa field lạ (vd `roomId`), When gọi endpoint, Then trả 400 (do `forbidNonWhitelisted`).
- AC-005: Given user không phải organizer/host, When gọi endpoint, Then trả 403.
- AC-006: Given meeting đã `cancelled` hoặc `completed`, When gọi endpoint, Then trả 409 `INVALID_MEETING_STATUS`.

## 5. Kỹ thuật

- Thêm giá trị enum mới `MeetingEventType.METADATA_UPDATED = 'metadata_updated'` (cột `event_type` là `varchar`, không có DB CHECK constraint — an toàn thêm giá trị enum tầng ứng dụng, không cần migration).
- Service riêng `MeetingUpdateService`, không nhồi vào `meetings.service.ts` (đã 5000+ dòng, §15 CLAUDE.md).

## 6. Ngoài phạm vi

- Đổi organizer/host của meeting.
- Đổi bất kỳ field nào khác ngoài title/description (xem bảng §2).
