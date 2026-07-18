# Quickstart: Xóa agenda item (UC-MM-11)

- **Feature ID**: UC-MM-11
- **Target**: `DELETE /api/v1/meetings/{meetingId}/agendas/{agendaId}`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Host xóa item ở giữa danh sách | Meeting có 3 item (order 1-3), DELETE item order=2 | 200, item order=3 renormalize thành order=2, còn lại 2 item |
| 2 | Host xóa item cuối danh sách | Meeting có 3 item, DELETE item order=3 | 200, item order 1-2 giữ nguyên, không renormalize |
| 3 | Host xóa item duy nhất | Meeting có 1 item, DELETE item đó | 200, `remainingItemCount = 0` |
| 4 | Organizer xóa item | DELETE bởi organizer (không phải host) | 200 |
| 5 | Admin xóa item (có permission) | DELETE bởi admin có `meeting.agenda.write` | 200 |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 6 | Unauthenticated | DELETE không JWT | 401 UNAUTHORIZED |
| 7 | Participant thường | DELETE bởi user không phải organizer/host/admin | 403 AGENDA_WRITE_FORBIDDEN |

### Not Found / Idempotency

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 8 | Meeting không tồn tại | DELETE với meetingId ngẫu nhiên | 404 MEETING_NOT_FOUND |
| 9 | agendaId không tồn tại | DELETE với agendaId ngẫu nhiên | 404 AGENDA_ITEM_NOT_FOUND |
| 10 | agendaId thuộc meeting khác | DELETE agendaId của meeting B qua path meeting A | 404 AGENDA_ITEM_NOT_FOUND, item của meeting B không bị ảnh hưởng |
| 11 | Double DELETE liên tiếp | DELETE cùng agendaId 2 lần | Lần 1: 200, lần 2: 404 AGENDA_ITEM_NOT_FOUND |

### Business Rule / State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 12 | Meeting completed | DELETE trên meeting đã completed | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 13 | Meeting cancelled | DELETE trên meeting đã cancelled | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 14 | Meeting in_progress | DELETE trên meeting đang họp | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 15 | Meeting pending_approval | DELETE trên meeting chưa được duyệt | 409 AGENDA_MEETING_STATUS_BLOCKED |

### Concurrency

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 16 | DELETE và PUT gần như đồng thời trên cùng meeting | Gửi DELETE item A và PUT toàn bộ danh sách cùng lúc | Cả hai thành công tuần tự (không mất dữ liệu), nhờ lock chung |
| 17 | DELETE và PATCH gần như đồng thời trên cùng meeting | Gửi DELETE item A và PATCH item B cùng lúc | Cả hai thành công tuần tự |
| 18 | Hai DELETE đồng thời cho cùng agendaId | Gửi 2 request DELETE cùng agendaId gần như đồng thời | 1 request 200, request còn lại 404 |

## Verification Notes

- [ ] `meeting_agendas` không còn row với `id = agendaId` sau khi xóa thành công.
- [ ] `agenda_order` của các item còn lại trong meeting vẫn 1..N liên tục sau mỗi lần xóa.
- [ ] `audit_logs` có bản ghi `action_type = 'agenda_item_deleted'` với `old_value_json` chứa snapshot đầy đủ, `new_value_json = null`.
- [ ] Response trả đúng `remainingItemCount`, `totalPlannedDurationMinutes`, `remainingDurationMinutes` sau khi xóa.
- [ ] `PUT /agendas` (UC-MM-09) và `PATCH /agendas/{agendaId}` (UC-MM-10) vẫn hoạt động bình thường (regression check).
- [ ] Xóa item của meeting A không ảnh hưởng tới `agenda_order` của meeting B.
