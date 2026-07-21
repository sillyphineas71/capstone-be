# Quickstart - Xem danh sach toan bo booking phong hien tai

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi quickstart cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-21 | Them Manager scope test cases (#10, #11), renumber test IDs, them verification note | Authorization Cases, Null/Pagination/Validation, Verification Notes |

---

## Happy Path

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 1 | Admin lay danh sach bookings | GET /api/v1/room-bookings | 200, data, sort reservedStartTime DESC |
| 2 | Filter roomId | ?roomId=uuid | Chi tra booking dung phong |
| 3 | Filter status | ?status=active | Chi tra active |
| 4 | Filter bookingType | ?bookingType=scheduled | Dung loai |
| 5 | Filter date range | ?from=...&to=... | Trong khoang |
| 6 | Search q | ?q=BK-001 | booking_code match |

## Authorization Cases

| # | Test Case | Expected |
|---|-----------|----------|
| 7 | Khong permission room.booking.read | 403 Forbidden |
| 8 | SYSTEM_ADMIN thay toan bo | 200 full data |
| 9 | BUSINESS_ADMIN thay toan bo | 200 full data |
| 10 | MANAGER chi thay booking trong scope | 200 chi booking co bookedBy thuoc pham vi quan ly |
| 11 | MANAGER khong co booking trong scope | 200 data=[] |

## Null Relation Cases

| # | Test Case | Expected |
|---|-----------|----------|
| 12 | meeting_id = null | meeting = null, khong loi |
| 13 | approved_by = null | approvedByUser = null, khong loi |

## Pagination Cases

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 14 | Phan trang chuan | page=1&limit=20, 50 total | 20 items, total=50, totalPages=3 |
| 15 | Page out of range | page=999 | 200 data=[] |

## Validation Cases

| # | Test Case | Input | Expected |
|---|-----------|-------|----------|
| 16 | page < 1 | page=0 | 400 |
| 17 | limit > 100 | limit=200 | 400 |
| 18 | invalid status | status=invalid | 422 |
| 19 | invalid bookingType | bookingType=invalid | 422 |
| 20 | invalid UUID | roomId=not-uuid | 400 |
| 21 | from > to | from=2026-07-01&to=2026-06-01 | 400 |
| 22 | invalid sortBy | sortBy=password_hash | 400 |
| 23 | Khong auth | No JWT | 401 |

## Verification Notes

- [ ] Response format: { success, message, data, meta }
- [ ] Null relations khong gay loi
- [ ] meta.page, meta.limit, meta.total, meta.totalPages chinh xac
- [ ] SYSTEM_ADMIN/BUSINESS_ADMIN thay toan bo
- [ ] MANAGER chi thay booking trong pham vi quan ly (bookedBy.directManagerId / department.managerUserId)
- [ ] Khong permission > 403
- [ ] Sort mac dinh reservedStartTime DESC, page=1, limit=20

