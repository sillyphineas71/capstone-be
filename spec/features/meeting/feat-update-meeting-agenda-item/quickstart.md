# Quickstart: Chỉnh sửa agenda item (UC-MM-10)

- **Feature ID**: UC-MM-10
- **Target**: `PATCH /api/v1/meetings/{meetingId}/agendas/{agendaId}`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Host sửa title | PATCH `{ "title": "..." }` | 200, chỉ title đổi, các field khác giữ nguyên |
| 2 | Host sửa plannedDurationMinutes (không overflow) | PATCH `{ "plannedDurationMinutes": 20 }` | 200, tổng duration cập nhật đúng |
| 3 | Organizer đổi ownerId | PATCH `{ "ownerId": "<participant-uuid>" }` | 200, `ownerName` trả đúng |
| 4 | Host un-assign owner | PATCH `{ "ownerId": null }` | 200, `ownerId`/`ownerName` = null |
| 5 | Host đổi agendaOrder (di chuyển lên đầu) | PATCH `{ "agendaOrder": 1 }` trên item đang ở vị trí 3/5 | 200, các item 1-2 dịch xuống 2-3 |
| 6 | Host đổi agendaOrder (di chuyển xuống cuối) | PATCH `{ "agendaOrder": 5 }` trên item đang ở vị trí 2/5 | 200, các item 3-5 dịch lên 2-4 |
| 7 | Sửa nhiều field cùng lúc | PATCH `{ "title": "...", "plannedDurationMinutes": 25, "ownerId": "..." }` | 200, cả 3 field đổi |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 8 | Unauthenticated | PATCH không JWT | 401 UNAUTHORIZED |
| 9 | Participant thường | PATCH bởi user không phải organizer/host/admin | 403 AGENDA_WRITE_FORBIDDEN |

### Not Found

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 10 | Meeting không tồn tại | PATCH với meetingId ngẫu nhiên | 404 MEETING_NOT_FOUND |
| 11 | agendaId không tồn tại | PATCH với agendaId ngẫu nhiên | 404 AGENDA_ITEM_NOT_FOUND |
| 12 | agendaId thuộc meeting khác | PATCH agendaId của meeting B qua path meeting A | 404 AGENDA_ITEM_NOT_FOUND |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 13 | title rỗng sau trim | PATCH `{ "title": "   " }` | 422 AGENDA_TITLE_REQUIRED |
| 14 | title > 255 | PATCH title dài 300 ký tự | 422 AGENDA_TITLE_TOO_LONG |
| 15 | description > 2000 | PATCH description dài 2100 ký tự | 422 AGENDA_DESCRIPTION_TOO_LONG |
| 16 | plannedDurationMinutes = 0 | PATCH `{ "plannedDurationMinutes": 0 }` | 422 AGENDA_INVALID_DURATION |
| 17 | plannedDurationMinutes không phải integer | PATCH `{ "plannedDurationMinutes": 12.5 }` | 400 AGENDA_INVALID_PAYLOAD (DTO reject) |
| 18 | ownerId không thuộc participants | PATCH ownerId là user ngoài meeting | 422 AGENDA_OWNER_NOT_PARTICIPANT |
| 19 | agendaOrder ngoài khoảng | PATCH `{ "agendaOrder": 99 }` khi meeting chỉ có 3 item | 422 AGENDA_INVALID_ORDER |
| 20 | body rỗng | PATCH `{}` | 400 AGENDA_UPDATE_PAYLOAD_EMPTY |
| 21 | field ngoài whitelist | PATCH `{ "status": "in_progress" }` | 400 AGENDA_INVALID_PAYLOAD |

### Business Rule / State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 22 | Meeting completed | PATCH trên meeting đã completed | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 23 | Meeting cancelled | PATCH trên meeting đã cancelled | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 24 | Meeting in_progress | PATCH trên meeting đang họp | 409 AGENDA_MEETING_STATUS_BLOCKED |
| 25 | Duration overflow | PATCH plannedDurationMinutes khiến tổng > meeting duration | 422 AGENDA_DURATION_OVERFLOW |
| 26 | Meeting time invalid | Meeting thiếu start_time/end_time | 409 MEETING_TIME_INVALID_FOR_AGENDA |

### No-op & Concurrency

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 27 | PATCH giống hệt DB | PATCH title đúng bằng giá trị hiện tại | 200, không đổi `updated_at`, không audit log mới |
| 28 | PATCH và PUT gần như đồng thời trên cùng meeting | Gửi PATCH item A và PUT toàn bộ danh sách cùng lúc | Cả hai đều thành công tuần tự (không mất dữ liệu), nhờ lock chung |
| 29 | Double PATCH cùng agendaId liên tiếp | Gửi 2 PATCH khác field liên tiếp | Cả 2 thành công, kết quả cuối phản ánh cả 2 thay đổi |

## Verification Notes

- [ ] `meeting_agendas.updated_by`/`updated_at` chỉ đổi khi có thay đổi thực sự (không đổi khi no-op).
- [ ] `agenda_order` toàn bộ danh sách của meeting vẫn 1..N liên tục sau mỗi PATCH thành công có đổi order.
- [ ] `audit_logs` có bản ghi `action_type = 'agenda_item_updated'` với `old_value_json`/`new_value_json` chỉ chứa field thay đổi.
- [ ] Response trả đúng `totalPlannedDurationMinutes`/`remainingDurationMinutes` sau khi cập nhật.
- [ ] `PUT /agendas` (UC-MM-09) vẫn hoạt động bình thường, không bị ảnh hưởng bởi thay đổi này (regression check).
