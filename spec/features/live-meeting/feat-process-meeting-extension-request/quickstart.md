# Quickstart: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (UC-IMM-03)

**Feature Directory**: spec/features/live-meeting/feat-process-meeting-extension-request
**Date**: 2026-06-16

---

## Test Scenarios

### P0 — Happy Path: Approve thành công

**Steps:**
1. Seed: meeting đang `in_progress`, có `meeting_requests` với `request_type=extend_meeting`, `approval_status=pending`
2. Gọi `POST /api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide` với `{ decision: "approved" }`
3. Kiểm tra:
   - `meeting_requests.approval_status` = `applied`
   - `meeting_requests.decision_by` = userId của Manager
   - `meeting_requests.decision_at` != null
   - `meetings.end_time` = `requestedNewEndTime`
   - `room_bookings.reserved_end_time` = `requestedNewEndTime`
   - `room_booking_usages.reserved_end_time` = `requestedNewEndTime`
   - `meeting_events` có record event_type = `extension_approved`
   - `audit_logs` có record action_type = `extend_meeting`
   - `notifications` có record type = `meeting_extension_approved` cho Host

### P1 — Reject thành công (Manager reject)

**Steps:**
1. Seed: request pending hợp lệ
2. Gọi decide với `{ decision: "rejected", reason: "Phòng cần giải phóng" }`
3. Kiểm tra:
   - `meeting_requests.approval_status` = `rejected`
   - `meeting_requests.rejection_reason` = "Phòng cần giải phóng"
   - `meetings.end_time` không thay đổi
   - `room_bookings.reserved_end_time` không thay đổi
   - `meeting_events` có record event_type = `extension_rejected`
   - `audit_logs` có record action_type = `extend_meeting_reject`
   - `notifications` có record type = `meeting_extension_rejected` cho Host

### P2 — Re-validation Conflict (auto reject)

**Steps:**
1. Seed: request pending, meeting in_progress, nhưng có booking khác overlap trong `[oldEndTime, requestedNewEndTime)`
2. Gọi decide với `{ decision: "approved" }`
3. Kiểm tra:
   - Response 409 `ROOM_CONFLICT`
   - `meeting_requests.approval_status` = `rejected`
   - `meeting_requests.conflict_summary_json` có danh sách conflict
   - `meeting_requests.rejection_reason` = "Phòng đã có lịch đặt..."
   - `meetings.end_time` không thay đổi
   - `audit_logs` có record action_type = `extend_meeting`

### P3 — Permission denied

**Steps:**
1. Gọi decide với user không có permission `meeting.session.extension.decide`
2. Kiểm tra: Response 403 `PERMISSION_DENIED`

### P4 — User không trong approver list

**Steps:**
1. Gọi decide với user có `meeting.session.extension.decide` nhưng không trong approverIds
2. Kiểm tra: Response 403 `PERMISSION_DENIED`

### P5 — Admin override thành công

**Steps:**
1. Gọi decide với user có `meeting.session.extension.override`, không cần trong approverIds
2. Kiểm tra: Approve/reject thành công bình thường

### P6 — Request đã xử lý (idempotency)

**Steps:**
1. Seed: request có `approval_status = applied` (đã xử lý)
2. Gọi decide lần nữa
3. Kiểm tra: Response 409 `REQUEST_ALREADY_PROCESSED`, data không thay đổi

### P7 — Meeting không còn in_progress

**Steps:**
1. Seed: meeting có status = `completed`
2. Gọi decide approve
3. Kiểm tra: Response 409 `MEETING_NOT_ACTIVE`

### P8 — Decision invalid value

**Steps:**
1. Gọi decide với `{ decision: "invalid" }`
2. Kiểm tra: Response 422 `VALIDATION_ERROR`

### P9 — Race condition (concurrent decide)

**Steps:**
1. Gửi 2 request decide approve cùng lúc cho cùng requestId
2. Kiểm tra: Chỉ 1 request thành công, request kia nhận 409 `REQUEST_ALREADY_PROCESSED`

### P10 — Transaction rollback

**Steps:**
1. Mock một lỗi khi insert meeting_events
2. Gọi decide approve
3. Kiểm tra: Không có thay đổi nào được persist

---

## Verification Notes

- [ ] `meeting_requests.approval_status` chỉ chấp nhận `pending` → `applied` hoặc `rejected`
- [ ] Không cho phép request đã `applied` hoặc `rejected` bị xử lý lại
- [ ] `meetings.end_time` chỉ thay đổi khi approve path
- [ ] `room_bookings` và `room_booking_usages` chỉ thay đổi khi approve path
- [ ] Cả approve và reject đều ghi meeting_events + audit_logs
- [ ] Notification gửi cho Host (không phải Manager) trong cả approve và reject
- [ ] Re-validation conflict check exclude current booking
- [ ] Re-validation conflict check include booking status: pending, approved, active
- [ ] Lock trên cả 3 bảng: meeting_requests, meetings, room_bookings
- [ ] Re-check state sau lock (phòng Host end meeting trong lúc đang duyệt)
- [ ] Admin override cần explicit permission `meeting.session.extension.override`
- [ ] Không thay đổi `meetings.start_time`, `actual_start_time`, `actual_end_time`
- [ ] Không tạo overlap booking
