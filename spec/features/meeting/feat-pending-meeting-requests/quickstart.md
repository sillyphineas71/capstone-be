# Quickstart - Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

## Happy Path

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1 | Admin lấy pending requests | GET /api/v1/meeting-requests | 200, data pending, sort requestedAt DESC |
| 2 | Mặc định pending | GET /api/v1/meeting-requests (không param) | Chỉ trả pending |
| 3 | Filter approved | ?approvalStatus=approved | Chỉ trả approved |
| 4 | Filter requestType | ?requestType=create_meeting | Đúng loại |
| 5 | Filter targetRoomId | ?targetRoomId=uuid | Đúng phòng |
| 6 | Filter requestedById | ?requestedById=uuid | Đúng người tạo |
| 7 | Filter date range | ?from=...&to=... | Trong khoảng |
| 8 | Search q | ?q=REQ-001 | request_code match |
| 9 | Custom sort | ?sortBy=created_at&sortOrder=asc | Đúng sort |
| 10 | approvalStatus=all | ?approvalStatus=all | Tất cả status |

## Authorization Cases

| # | Test Case | Expected |
|---|-----------|----------|
| 11 | Không permission meeting_request.read | 403 Forbidden |
| 12 | SYSTEM_ADMIN thấy toàn bộ | 200 full data |
| 13 | Manager scope | Chỉ thấy request trong phạm vi |
| 14 | Manager không request trong scope | 200 data=[] |

## Null Relation Cases

| # | Test Case | Expected |
|---|-----------|----------|
| 15 | meeting_id = null | meeting = null, không lỗi |
| 16 | target_room_id = null | targetRoom = null, không lỗi |

## Pagination Cases

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 17 | Phân trang chuẩn | page=1&limit=20, 50 total | 20 items, total=50, totalPages=3 |
| 18 | Page out of range | page=999 | 200 data=[] |

## Validation Cases

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 19 | page < 1 | page=0 | 400 |
| 20 | limit > 100 | limit=200 | 400 |
| 21 | invalid approvalStatus | approvalStatus=invalid | 422 |
| 22 | invalid requestType | requestType=invalid | 422 |
| 23 | invalid UUID | targetRoomId=not-uuid | 400 |
| 24 | from > to | from=2026-07-01&to=2026-06-01 | 400 |
| 25 | invalid sortBy | sortBy=password_hash | 400 |
| 26 | Không auth | No JWT | 401 |

## Verification Notes

- [ ] Response format: { success, message, data, meta }
- [ ] Null relations không gây lỗi
- [ ] conflictSummary raw JSON không mutate
- [ ] meta.page, meta.limit, meta.total, meta.totalPages chính xác
- [ ] SYSTEM_ADMIN/BUSINESS_ADMIN thấy toàn bộ
- [ ] Manager chỉ thấy trong scope
- [ ] Không permission > 403
- [ ] Default pending, sort requestedAt DESC, page=1, limit=20
