# Quickstart: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Created**: 2026-06-10

---

## 1. Test Scenarios

### Happy Paths

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 1 | Thêm user vào meeting scheduled (không warning) | 1. POST với userId hợp lệ, meeting scheduled<br>2. Không có conflict, capacity OK | 201 Created, participant created, notification + bg_job created |
| 2 | Thêm user vào meeting in_progress (không warning) | Tương tự #1 với meeting in_progress | 201 Created + device sync event emitted |
| 3 | Override schedule conflict (2-step) | 1. POST lần 1 → 422 warningToken<br>2. POST lần 2 với overrideWarnings=true + warningToken | 201 Created |

### Error Cases

| # | Scenario | Steps | Expected Result |
|---|----------|-------|-----------------|
| 4 | Meeting không tồn tại | POST với meetingId không có | 404 MEETING_NOT_FOUND |
| 5 | User không tồn tại | POST với userId không có | 404 USER_NOT_FOUND |
| 6 | User inactive | POST với userId có account_status != active | 404 USER_NOT_FOUND |
| 7 | Meeting status invalid | POST với meeting cancelled/completed | 400 INVALID_MEETING_STATUS |
| 8 | Private meeting + Manager (không phải Org/Host) | POST vào private meeting với Manager role | 403 FORBIDDEN_ACCESS |
| 9 | Private meeting + Admin | POST vào private meeting với Admin role | 201 Created |
| 10 | Private meeting + Organizer | POST vào private meeting với Organizer | 201 Created |
| 11 | Duplicate participant | POST 2 lần cùng userId-meetingId | 201 lần 1, 409 lần 2 |
| 12 | Race condition duplicate | 2 request đồng thời cùng userId-meetingId | 1 thành công 201, 1 fail 409 |
| 13 | No overrideWarnings flag + conflict | POST lần 1 với overrideWarnings=true nhưng không warningToken | 422 WARNING_CONFIRMATION_REQUIRED |
| 14 | Invalid warningToken | POST với warningToken sai/expired | 400 INVALID_WARNING_TOKEN |
| 15 | Capacity block policy | meeting.capacity_policy='block', room đầy | 422 ROOM_CAPACITY_EXCEEDED |
| 16 | Capacity warning + Organizer không có override quyền | policy='warning', room đầy, user không có override_capacity permission | 422 ROOM_CAPACITY_EXCEEDED |
| 17 | Capacity warning + Admin có override | policy='warning', room đầy, Admin có override permission + 2-step confirm | 201 Created |

---

## 2. Verification Notes

### Sau khi implement, kiểm tra:

- [ ] `POST /api/v1/meetings/:meetingId/participants/internal` trả về đúng response cho tất cả error codes
- [ ] 2-step warning flow hoạt động: request đầu 422 → request thứ 2 201
- [ ] `warningToken` JWT có TTL 5 phút, sai token bị 400
- [ ] Capacity policy `warning` vs `block` hoạt động đúng
- [ ] Private meeting chỉ cho phép Organizer/Host/Admin thêm người
- [ ] Meeting `in_progress` emit event/schedule bg_job cho device sync (best-effort)
- [ ] Unique constraint `(meeting_id, user_id)` bắt được race condition → 409
- [ ] Audit log ghi đúng action `ADD_PARTICIPANT`
- [ ] Notification + background_job được tạo sau transaction (không rollback nếu fail)
- [ ] Unit test pass: DTO validation, service logic, controller response
- [ ] Build pass: `npm run build` / `nest build`
- [ ] Lint pass: `npm run lint`
