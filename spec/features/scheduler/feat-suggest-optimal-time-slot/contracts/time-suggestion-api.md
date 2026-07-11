# API Contract: POST /api/v1/scheduling/time-suggestions

**Permission**: `scheduling.suggest.times`
**Auth**: `JwtAuthGuard` + `PermissionsGuard`

## Request

```http
POST /api/v1/scheduling/time-suggestions
Authorization: Bearer <token>
Content-Type: application/json

{
  "requiredParticipantUserIds": ["uuid-manager-1", "uuid-manager-2"],
  "optionalParticipantUserIds": ["uuid-emp-3", "uuid-emp-4"],
  "externalParticipantEmails": ["partner@external.com"],
  "searchRangeStart": "2026-07-13T00:00:00+07:00",
  "searchRangeEnd": "2026-07-18T23:59:59+07:00",
  "durationMinutes": 60,
  "maxSuggestions": 5
}
```

## Response 200 — Có kết quả

```json
{
  "success": true,
  "message": "Danh sách khung giờ đề xuất",
  "data": [
    {
      "startTime": "2026-07-14T10:00:00+07:00",
      "endTime": "2026-07-14T11:00:00+07:00",
      "matchScore": 100,
      "requiredFreeCount": 2,
      "requiredTotal": 2,
      "optionalFreeCount": 2,
      "optionalTotal": 2,
      "busyParticipants": []
    },
    {
      "startTime": "2026-07-15T14:00:00+07:00",
      "endTime": "2026-07-15T15:00:00+07:00",
      "matchScore": 80,
      "requiredFreeCount": 2,
      "requiredTotal": 2,
      "optionalFreeCount": 1,
      "optionalTotal": 2,
      "busyParticipants": [
        { "userId": "uuid-emp-4", "busyFrom": "2026-07-15T14:00:00+07:00", "busyTo": "2026-07-15T15:30:00+07:00" }
      ]
    }
  ],
  "meta": {
    "searchRangeStart": "2026-07-13T00:00:00+07:00",
    "searchRangeEnd": "2026-07-18T23:59:59+07:00",
    "durationMinutes": 60,
    "totalCandidatesEvaluated": 14,
    "resultLimit": 5
  }
}
```

## Response 200 — Không tìm thấy khung giờ (Exception E1)

```json
{
  "success": true,
  "message": "Không tìm thấy khung giờ chung nào phù hợp. Vui lòng thử mở rộng khoảng thời gian tìm kiếm hoặc giảm bớt số lượng khách mời.",
  "data": [],
  "meta": {
    "searchRangeStart": "2026-07-13T00:00:00+07:00",
    "searchRangeEnd": "2026-07-18T23:59:59+07:00",
    "durationMinutes": 60,
    "totalCandidatesEvaluated": 0,
    "resultLimit": 5
  }
}
```

## Response 422 — Validation error (ví dụ khoảng tìm kiếm quá dài)

```json
{
  "success": false,
  "message": "Khoảng thời gian tìm kiếm không được vượt quá 30 ngày.",
  "error": { "code": "SCHEDULING_SEARCH_RANGE_TOO_LONG", "details": {} },
  "timestamp": "2026-07-10T09:00:00.000Z",
  "path": "/api/v1/scheduling/time-suggestions"
}
```
