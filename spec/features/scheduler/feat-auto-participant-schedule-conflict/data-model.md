# Data Model: Participant Conflict Check (UC-SM-04)

## Entities & Tables

### Core Entities (dùng cho tính toán conflict)

#### meetings

| Field | Type | Vai trò |
|---|---|---|
| id | uuid (PK) | Định danh cuộc họp |
| status | varchar(30) | COMPLETED, CANCELLED → loại trừ khỏi conflict check |
| start_time | timestamptz | Thời gian bắt đầu |
| end_time | timestamptz | Thời gian kết thúc |
| deleted_at | timestamptz (nullable) | Soft delete → loại trừ nếu != NULL |

#### meeting_participants

| Field | Type | Vai trò |
|---|---|---|
| id | uuid (PK) | Định danh |
| meeting_id | uuid (FK → meetings) | Liên kết meeting |
| user_id | uuid (FK → users) | Liên kết user (participant) |

#### users

| Field | Type | Vai trò |
|---|---|---|
| id | uuid (PK) | Định danh user |
| deleted_at | timestamptz (nullable) | Soft delete → loại trừ |

### Entities cho Submit Re-check

#### meeting_requests

| Field | Type | Vai trò |
|---|---|---|
| id | uuid (PK) | Định danh request |
| conflict_check_status | varchar(30) | Ghi nhận: 
ot_checked, clear, warning, locked |
| conflict_checked_at | timestamptz (nullable) | Thời điểm check |
| conflict_summary_json | jsonb (nullable) | Snapshot chi tiết conflict |

**Conflict Summary JSON Schema (lưu vào conflict_summary_json):**
`json
{
  "checkedAt": "2026-06-16T10:00:00+07:00",
  "hasConflict": true,
  "participantConflicts": [
    {
      "userId": "uuid",
      "status": "busy",
      "busySlots": [
        { "busyFrom": "2026-06-16T14:00:00+07:00", "busyTo": "2026-06-16T15:30:00+07:00" }
      ]
    }
  ],
  "externalParticipantEmails": ["guest@external.com"]
}
`

### Entities không cần dùng cho feature này

- meeting_external_participants: Không check conflict, chỉ trả unknown.
- oom_bookings: Room conflict không thuộc scope.
- schedule_conflicts: Bảng đã bị loại khỏi DB compact.

## Conflict Detection Query

`sql
SELECT DISTINCT mp.user_id
FROM meeting_participants mp
JOIN meetings m ON m.id = mp.meeting_id
WHERE mp.user_id IN (:...participantUserIds)
  AND m.deleted_at IS NULL
  AND m.status NOT IN ('cancelled', 'completed')
  AND m.start_time < :requestedEndTime
  AND m.end_time > :requestedStartTime
  AND m.id != COALESCE(:excludeMeetingId, '00000000-0000-0000-0000-000000000000')
`

### Busy slots query (cho từng user conflict)

`sql
SELECT m.start_time, m.end_time
FROM meeting_participants mp
JOIN meetings m ON m.id = mp.meeting_id
WHERE mp.user_id = :userId
  AND m.deleted_at IS NULL
  AND m.status NOT IN ('cancelled', 'completed')
  AND m.start_time < :requestedEndTime
  AND m.end_time > :requestedStartTime
  AND m.id != COALESCE(:excludeMeetingId, '00000000-0000-0000-0000-000000000000')
-- Sau đó merge overlapping/adjacent slots
`

## State Transitions

### conflict_check_status

`
not_checked ──→ clear   (không conflict)
             └─→ warning (có conflict)
`

- locked: Dành cho room/policy conflict ở tính năng khác. Không dùng trong feature này.
- Chỉ ghi một lần khi tạo meeting request, không tự động cập nhật.

### Participant status (trong response)

`
free    ──→ busy (khi thêm participant bận)
busy    ──→ free (khi đổi giờ hết conflict)
unknown ──→ luôn unknown (external)
`

## Validation Rules

| Field | Rule | Error Code |
|---|---|---|
| startTime | Required, valid ISO-8601 | VALIDATION_ERROR |
| endTime | Required, valid ISO-8601, > startTime | VALIDATION_ERROR |
| participantUserIds | Array UUID, max 50, no duplicate, all users exist | VALIDATION_ERROR |
| excludeMeetingId | Optional, valid UUID, user must have access | VALIDATION_ERROR / FORBIDDEN |
| externalParticipantEmails | Optional, valid email format | VALIDATION_ERROR |

## Data Lifecycle

1. **Realtime check**: Không lưu dữ liệu. Tính toán trong request-response.
2. **Submit re-check**: Ghi conflict_summary_json + conflict_check_status + conflict_checked_at vào meeting_requests.
3. **Không có update**: Snapshot chỉ ghi 1 lần.
