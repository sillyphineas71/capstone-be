# Quickstart — Duyệt hoặc từ chối yêu cầu cuộc họp

## Kịch bản Test Chính

### Happy Path

| # | Test Case | Input | Expected | Verification |
|---|-----------|-------|----------|-------------|
| 1 | Approve thành công | `POST /meeting-requests/{id}/approve` với `decisionNote: "OK"` | 200, approvalStatus=approved, meetingStatus=scheduled, bookingStatus=approved | Check DB: meeting_requests, meetings, room_bookings |
| 2 | Reject thành công | `POST /meeting-requests/{id}/reject` với `rejectionReason: "Trùng lịch"` | 200, approvalStatus=rejected, meetingStatus=cancelled, bookingStatus=cancelled | Check DB: cả 3 bảng |
| 3 | Approve tạo notification | Approve thành công → có notification `MEETING_INVITE` cho participants | notification records tồn tại | Check notifications table |
| 4 | Approve tạo audit log | Approve thành công → có audit log `approve` | audit_logs có record | Check audit_logs table |
| 5 | Reject tạo audit log | Reject thành công → có audit log `reject` | audit_logs có record | Check audit_logs table |

### Error Cases

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 6 | Request không tồn tại | ID không có trong DB | 404 Not Found |
| 7 | Request đã approved | Approve lần 2 | 409 Conflict |
| 8 | Request đã rejected | Approve request đã reject | 409 Conflict |
| 9 | Room conflict | Booking khác overlap | 409 ROOM_CONFLICT |
| 10 | Missing rejectionReason | Reject không có reason | 400 Validation Error |
| 11 | rejectionReason chỉ whitespace | Reject với `"   "` | 400 Validation Error |
| 12 | decisionNote quá 500 ký tự | Approve với note 501 ký tự | 400 Validation Error |
| 13 | rejectionReason quá 1000 ký tự | Reject với reason 1001 ký tự | 400 Validation Error |
| 14 | Không permission approve | User không có `meeting_request.approve` | 403 Forbidden |
| 15 | Không permission reject | User không có `meeting_request.reject` | 403 Forbidden |
| 16 | Self-approval | User approve request của chính mình | 403 SELF_APPROVAL_NOT_ALLOWED |
| 17 | Self-reject | User reject request của chính mình | 403 SELF_APPROVAL_NOT_ALLOWED |
| 18 | request_type không phải create_meeting | request có type `cancel_meeting` | 422 UNSUPPORTED_REQUEST_TYPE |
| 19 | Không đăng nhập | Gọi API không có JWT | 401 Unauthorized |

### Transaction / Consistency

| # | Test Case | Scenario | Expected |
|---|-----------|----------|----------|
| 20 | Rollback khi update booking fail | Mock lỗi ở update booking | Không có thay đổi nào được persist |
| 21 | Race condition — double approval | 2 request đồng thời cùng requestId | 1 thành công, 1 fail 409 |
| 22 | Confirm không tạo meeting_invite khi reject | Reject thành công | Không có MEETING_INVITE notification |

---

## Verification Notes

### DB Verification Checklist

Sau approve:
- [ ] `meeting_requests.approval_status` = `approved`
- [ ] `meeting_requests.decision_by` = approver ID
- [ ] `meeting_requests.decision_at` = timestamp
- [ ] `meeting_requests.applied_at` = timestamp
- [ ] `meetings.status` = `scheduled`
- [ ] `meetings.updated_by` = approver ID
- [ ] `room_bookings.status` = `approved`
- [ ] `room_bookings.approved_by` = approver ID
- [ ] `room_bookings.approved_at` = timestamp
- [ ] `meeting_events` có record `meeting_request_approved`
- [ ] `notifications` có MEETING_INVITE cho participants
- [ ] `notifications` có MEETING_REQUEST_APPROVED cho creator/host
- [ ] `audit_logs` có action_type = `approve`

Sau reject:
- [ ] `meeting_requests.approval_status` = `rejected`
- [ ] `meeting_requests.rejection_reason` = reason
- [ ] `meeting_requests.decision_by` = approver ID
- [ ] `meeting_requests.decision_at` = timestamp
- [ ] `meeting_requests.applied_at` = null (không ghi)
- [ ] `meetings.status` = `cancelled`
- [ ] `meetings.cancellation_reason` = reason
- [ ] `room_bookings.status` = `cancelled`
- [ ] `room_bookings.cancellation_reason` = reason
- [ ] `meeting_events` có record `meeting_request_rejected`
- [ ] `notifications` có MEETING_REQUEST_REJECTED cho creator/host
- [ ] `notifications` KHÔNG có MEETING_INVITE
- [ ] `audit_logs` có action_type = `reject`

### API Response Verification

- [ ] Success response format: `{ success, message, data }`
- [ ] Error response format: `{ success, message, error: { code, details } }`
- [ ] HTTP status codes đúng theo spec
- [ ] Error codes tuân thủ convention (SCREAMING_SNAKE_CASE)
