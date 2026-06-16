# Quickstart: Participant Conflict Check (UC-SM-04)

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Participant busy — realtime check | POST /api/v1/scheduling/participant-conflicts/check với userId đang có meeting khác trùng giờ | status: busy, usySlots có 1 slot, displayWarning: true |
| 2 | Participant free — realtime check | POST với userId không có meeting trùng | status: free, usySlots: [], displayWarning: false |
| 3 | External participant | POST với externalParticipantEmails: ["x@y.com"] | status: unknown, warningMessage: "Không rõ lịch trình" |
| 4 | Submit re-check có conflict | Gọi tạo meeting request với participant busy | Request tạo thành công, conflictCheckStatus: warning |
| 5 | Submit re-check không conflict | Gọi tạo meeting request với participants đều rảnh | Request tạo thành công, conflictCheckStatus: clear |

### Edge Cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 6 | Change time — conflict cleared | Thêm participant busy, đổi startTime khiến hết conflict | status: free |
| 7 | Overlap cross boundary | Participant từ 13:00-15:00, request 14:00-16:00 | status: busy (existing.end 15:00 > requestedStart 14:00) |
| 8 | Exclude meeting | Edit meeting, pass excludeMeetingId = chính meeting đó | status: free (không tự conflict) |
| 9 | Merge busy slots | Participant có meetings 14-15, 14:30-15:30, 15:30-16 | usySlots: [{ busyFrom: 14:00, busyTo: 16:00 }] (merge) |
| 10 | IDOR — excludeMeetingId | Truyền meetingId không có quyền truy cập | 403 Forbidden |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 11 | startTime > endTime | POST với startTime > endTime | 400 VALIDATION_ERROR |
| 12 | Invalid UUID | POST với participantUserIds: ["abc"] | 400 VALIDATION_ERROR |
| 13 | User not found | POST với UUID không tồn tại | 400 VALIDATION_ERROR |
| 14 | Exceed limit | POST với >50 userIds | 400 PARTICIPANT_CONFLICT_CHECK_LIMIT_EXCEEDED |
| 15 | Duplicate userIds | POST với participantUserIds: ["id", "id"] | 400 VALIDATION_ERROR |

### Authorization

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 16 | No token | Gọi API không có Authorization header | 401 Unauthorized |
| 17 | No permission | Gọi API với user không có scheduling.conflict.participant.check | 403 Forbidden |

## Verification Notes

- [ ] Check conflict_summary_json trong DB sau khi tạo meeting request
- [ ] Check conflict_check_status và conflict_checked_at được set đúng
- [ ] Verify response KHÔNG có title/description/room của meeting khác
- [ ] Verify participant busy không trả 409/422
- [ ] Verify busy slot merge hoạt động khi các slot chồng lấn/tiếp nối
