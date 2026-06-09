# Quickstart: UC-MM-02 — Cập nhật thời gian họp

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Initial quickstart with test scenarios | All |

---

## 1. Test Scenarios

### 1.1 Happy Path — AC-001

**Input:**
- User: Creator của meeting (status `scheduled`)
- Body: `{ startTime: "2026-07-01T09:00:00+07:00", endTime: "2026-07-01T10:30:00+07:00" }`
- Room: Không conflict, không participant conflict

**Expected:** HTTP 200, data chứa old/new times, bookingId, notificationStatus = `'queued'`

**Verify:**
- [ ] `meetings.start_time` và `end_time` được cập nhật
- [ ] `room_bookings.reserved_start/end_time` khớp
- [ ] `meeting_events` có record `meeting_time_updated`
- [ ] `audit_logs` có record `action_type = 'update'`
- [ ] `meeting_requests` có record `request_type = 'update_time'`
- [ ] `notifications` có record `notification_type = 'meeting_time_updated'`
- [ ] Các field khác (title, description) không thay đổi

### 1.2 Admin Override — AC-002

**Input:**
- User: Admin với `meeting.time.update.any`
- Body: hợp lệ
- Meeting: không phải của admin

**Expected:** HTTP 200

### 1.3 Invalid Time Range — AC-003

**Input:** `startTime >= endTime`

**Expected:** HTTP 422, error code `INVALID_TIME_RANGE`

### 1.4 Past Time — AC-004

**Input:** `startTime` trong quá khứ

**Expected:** HTTP 422, error code `MEETING_TIME_IN_PAST`

### 1.5 Invalid UUID — AC-005

**Input:** `meetingId` không phải UUID

**Expected:** HTTP 400, error code `INVALID_UUID`

### 1.6 Unauthenticated — AC-006

**Input:** Không gửi JWT token

**Expected:** HTTP 401

### 1.7 Forbidden (Participant) — AC-007

**Input:** User là participant thường

**Expected:** HTTP 403, `MEETING_TIME_UPDATE_FORBIDDEN`

### 1.8 Forbidden (No Permission) — AC-008

**Input:** User authenticated nhưng không phải Creator/Host/Admin của meeting

**Expected:** HTTP 403, `MEETING_TIME_UPDATE_FORBIDDEN`

### 1.9 Meeting In Progress — AC-009

**Input:** Meeting status `in_progress`

**Expected:** HTTP 409, `MEETING_STATUS_NOT_EDITABLE`

### 1.10 Meeting Completed — AC-010

**Input:** Meeting status `completed`

**Expected:** HTTP 409, `MEETING_STATUS_NOT_EDITABLE`

### 1.11 Meeting Cancelled — AC-011

**Input:** Meeting status `cancelled`

**Expected:** HTTP 409, `MEETING_STATUS_NOT_EDITABLE`

### 1.12 Room Conflict — AC-012

**Input:** Phòng hiện tại có booking khác trong khung giờ mới, không gửi `newRoomId`

**Expected:** HTTP 409, `ROOM_TIME_CONFLICT`, `blocking: true`

### 1.13 Change Room Success — AC-013

**Input:** Phòng hiện tại conflict + `newRoomId` hợp lệ + phòng mới available

**Expected:** HTTP 200, room_id thay đổi, booking_type = `'relocated'`

### 1.14 Participant Conflict Warning — AC-014

**Input:** Participant có meeting conflict, không gửi `overrideParticipantConflict`

**Expected:** HTTP 409, `PARTICIPANT_TIME_CONFLICT_WARNING`, `blocking: false`

### 1.15 Override Participant Conflict — AC-015

**Input:** Participant conflict + `overrideParticipantConflict: true` + không có room conflict

**Expected:** HTTP 200, update thành công

### 1.16 Data Integrity — AC-016, AC-017

**Input:** Update thành công

**Verify:**
- [ ] `meetings` chỉ thay đổi start/end time và room_id
- [ ] `room_bookings` khớp hoàn toàn với meetings
- [ ] Các field unrelated giữ nguyên

### 1.17 Audit & Events — AC-018, AC-019

**Input:** Update thành công

**Verify:**
- [ ] `audit_logs` có record
- [ ] `meeting_events` có record `meeting_time_updated`

### 1.18 Notification Queued — AC-020

**Input:** Update thành công

**Verify:**
- [ ] `notifications` có record với `delivery_status = 'queued'`
- [ ] recipients bao gồm tất cả participants

### 1.19 Duration Out of Range

**Input:** duration < 15 phút hoặc > 8 giờ

**Expected:** HTTP 422, `MEETING_DURATION_OUT_OF_RANGE`

### 1.20 Room Capacity Insufficient

**Input:** `newRoomId` với capacity < required attendee count

**Expected:** HTTP 409, `ROOM_CAPACITY_INSUFFICIENT`

### 1.21 Missing Booking Record (Edge Case 17)

**Input:** Meeting có `room_id` nhưng không có active booking

**Expected:** HTTP 200 (vẫn update), tạo booking mới, audit log có warning

### 1.22 Race Condition (Edge Case 18, 19)

**Input:** Hai request đồng thời cho cùng meeting/phòng

**Expected:** Request thứ hai nhận `ROOM_TIME_CONFLICT` hoặc kết quả đã cập nhật

---

## 2. Verification Notes

### 2.1 Pre-implementation Checklist
- [ ] `MeetingEventType` đã có `meeting_time_updated`?
- [ ] `NotificationType` đã có `meeting_time_updated`?
- [ ] `UpdateMeetingTimeDto` đã được tạo với validation đầy đủ?
- [ ] `MeetingsService` đã import đủ entities cho transaction?
- [ ] `MeetingsModule` đã import đủ TypeORM entities?

### 2.2 Post-implementation Checklist
- [ ] Build pass (tsc không lỗi)
- [ ] Unit test cho tất cả service methods
- [ ] Unit test cho DTO validation
- [ ] Integration test cho transaction boundary
- [ ] Integration test cho pessimistic locking behavior

### 2.3 Manual QA Notes
- Test với timezone khác nhau (UTC, +07:00, +09:00)
- Test khi booking đã bị cancelled/released (phải bị loại trừ khỏi conflict check)
- Test `newRoomId` có/không có
- Test `overrideParticipantConflict` = true/false/undefined
- Test `changeReason` rỗng, null, 500 ký tự, 501 ký tự
