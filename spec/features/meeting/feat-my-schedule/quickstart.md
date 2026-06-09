# Quickstart: UC-MM-05 Tra cứu lịch trình cá nhân

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | User xem lịch tuần hiện tại | `GET /api/v1/me/schedule?view=week&from=2026-06-08T00:00:00%2B07:00&to=2026-06-15T00:00:00%2B07:00` với JWT hợp lệ | 200, items chứa meeting liên quan |
| 2 | User xem popup chi tiết | `GET /api/v1/me/schedule/{meetingId}` với JWT của participant | 200, đầy đủ detail |
| 3 | Empty state | `GET /api/v1/me/schedule?view=day&from=2025-01-01T00:00:00%2B07:00&to=2025-01-02T00:00:00%2B07:00` | 200, items=[], empty=true |

### Validation / Error

| # | Scenario | Input | Expected |
|---|---|---|---|
| 4 | Thiếu tham số from | `GET /api/v1/me/schedule?view=week&to=...` | 400 MISSING_REQUIRED_PARAM |
| 5 | Date range ngược | `from=2026-06-15T00:00:00+07:00&to=2026-06-08T00:00:00+07:00` | 422 INVALID_DATE_RANGE |
| 6 | Range quá rộng (month) | `view=month&from=2026-01-01T00:00:00+07:00&to=2026-03-01T00:00:00+07:00` | 422 DATE_RANGE_TOO_WIDE |
| 7 | from thiếu offset | `from=2026-06-08T00:00:00` (no offset) | 400 INVALID_DATETIME_FORMAT |
| 8 | view không hợp lệ | `view=year` | 400 INVALID_VIEW_PARAM |
| 9 | timezone không hợp lệ | `timezone=ABC` | 400 INVALID_TIMEZONE |
| 10 | roomId không phải UUID | `roomId=abc` | 400 INVALID_UUID |

### Authorization

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 11 | Không có token | Request không có Authorization header | 401 UNAUTHENTICATED |
| 12 | Token hết hạn | Request với token đã hết hạn | 401 INVALID_TOKEN |
| 13 | User không phải participant | `GET /api/v1/me/schedule/{meetingId}` với user không liên quan | 403 FORBIDDEN_NOT_PARTICIPANT |
| 14 | Meeting không tồn tại | `GET /api/v1/me/schedule/{nonExistentId}` | 404 MEETING_NOT_FOUND |

### Business Rules

| # | Scenario | Setup | Expected |
|---|---|---|---|
| 15 | Overlap meeting vắt qua ranh giới | Meeting: start=2026-06-07T23:00+07:00, end=2026-06-08T01:00+07:00; query: view=day 2026-06-08 | Meeting vẫn xuất hiện |
| 16 | effectiveUserRole priority | User vừa là organizer vừa là participant | userRole = organizer (duy nhất 1 event) |
| 17 | Role filter by effectiveUserRole | User có effectiveUserRole = organizer, filter `role=attendee` | Meeting bị loại |
| 18 | q search on meeting_code | `q=001`, meeting có code "MTG-2026-001" | Meeting xuất hiện |
| 19 | q chỉ whitespace | `q=   ` | Filter bỏ qua, trả về full results |
| 20 | Cancelled vẫn hiển thị | Meeting có status=cancelled trong range | Meeting xuất hiện với status=cancelled |

## Verification Notes

### After Implementation

1. **Seed verification**: Verify `schedule.read.self` permission tồn tại trong DB và được gán cho các role mặc định.
2. **Entity registration**: Verify `MediaFileEntity`, `RecordingConfigEntity`, `UserEntity` được import đúng trong `MeetingsModule`.
3. **Query correctness**: Verify SQL query mẫu bằng cách chạy trực tiếp trên PostgreSQL với dữ liệu seed.
4. **Overlap test**: Test edge case meeting vắt qua ngày/tuần/tháng.
5. **effectiveUserRole test**: Test với user có cả 3 vai trò trong DB.

### Frontend Note

- `colorKey` trong response giống `status` — frontend dùng để mapping màu sắc.
- `isCurrent` và `isPast` được tính tại thời điểm request; frontend có thể tự refresh.
- `timezone` param chỉ ảnh hưởng đến response metadata, không ảnh hưởng đến query logic.
