# Quickstart — UC-MM-03 Cập nhật phòng họp

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Organizer đổi phòng thành công | Gọi PATCH `/meetings/:id/room` với `newRoomId` hợp lệ | 200 OK, booking mới tạo, booking cũ released, meeting.room_id cập nhật |
| 2 | Host đổi phòng thành công | Tương tự #1 nhưng user là host_id | 200 OK |
| 3 | Admin đổi phòng thành công | Tương tự #1 nhưng user là admin | 200 OK, audit log ghi actor là admin |
| 4 | GET available rooms | Gọi GET `/meetings/:id/available-rooms` | Danh sách phòng khả dụng, có capacityWarning nếu cần |

### Authorization

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 5 | Participant bị chặn | Participant gọi PATCH | 403 Forbidden |
| 6 | Unauthenticated bị chặn | Không token gọi PATCH | 401 Unauthorized |

### Validation & Business Rules

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 7 | Meeting không scheduled | Meeting status = completed/cancelled |
| 8 | Meeting đã bắt đầu | `now >= start_time` | 409 hoặc 422 |
| 9 | Chọn phòng trùng | `newRoomId` = current room | 422 error |
| 10 | Phòng conflict | Phòng bị booking khác chiếm | 409 Conflict |
| 11 | Capacity warning | Dưới capacity + `confirmCapacityOverride = false` | 422 ROOM_CAPACITY_WARNING |
| 12 | Override capacity | Gửi lại với `confirmCapacityOverride = true` | 200 OK |
| 13 | Room capacity null | Phòng có `capacity = null` | 422 ROOM_CAPACITY_NOT_CONFIGURED |
| 14 | Recurring series master | Meeting là series master | 409 RECURRING_SERIES_UPDATE_NOT_SUPPORTED |

### Data Integrity

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 15 | Transaction rollback | Mock lỗi sau release booking cũ | Rollback, không thay đổi dữ liệu |
| 16 | Booking cũ released | Sau khi đổi thành công | `room_bookings.status = released` |
| 17 | Booking mới tạo | Sau khi đổi thành công | `booking_type = relocated`, `status = approved` |
| 18 | Meeting event ghi | Sau khi đổi thành công | `meeting_events.event_type = room_changed` |
| 19 | Room event ghi | Sau khi đổi thành công | `room_events` cho phòng cũ và mới |
| 20 | Audit log ghi | Sau khi đổi thành công | `audit_logs.action_type = update_room` |
| 21 | Notification queued | Sau khi đổi thành công | `notifications` created, `background_jobs` queued |
| 22 | Các trường khác không đổi | Sau khi đổi thành công | title, time, participants không đổi |

### Edge Cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 23 | Double click submit | Gửi request 2 lần nhanh | Idempotency — không tạo duplicate booking |
| 24 | Meeting bị cancel trước submit | User mở form, người khác cancel | 409 Conflict tại submit |
| 25 | Notification job fail | Mock fail notification | Không rollback, ghi audit warning |

## Verification Notes

- [ ] Permission `meeting.room.update` đã có trong seed và DB
- [ ] Enum `MeetingEventType.ROOM_CHANGED` đã add
- [ ] Enum `NotificationType.MEETING_ROOM_UPDATED` đã add
- [ ] DTO validation hoạt động (required UUID, max length, boolean)
- [ ] Transaction rollback đúng — không có partial update
- [ ] Response format đúng convention `{ success, message, data }`
- [ ] Timestamp dùng `timestamptz`
- [ ] API prefix là `/api/v1/meetings/{meetingId}/room`
