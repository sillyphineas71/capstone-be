# Data Model: Xem danh sach nguoi tham du dang co mat

**Feature**: UC-IMM-07 | **Phase 1 output**

---

## 1. Entities (read-only)

### meetings

| Field | Type | Used for |
|---|---|---|
| id | UUID | meetingId (path param) |
| status | varchar | Kiem tra in_progress / scheduled |
| start_time | timestamptz | Time window check |
| end_time | timestamptz | Grace window check (end_time + 30m) |
| room_id | UUID (nullable) | Join presence_snapshots, AF Admin |
| host_id | UUID | Host ownership check |
| organizer_id | UUID | Backup ownership check |
| deleted_at | timestamptz (nullable) | Kiem tra soft-delete |

### meeting_participants

| Field | Type | Used for |
|---|---|---|
| meeting_id | UUID | Join key |
| user_id | UUID | Join key |
| participant_role | varchar | host, attendee, approver, note_taker |
| invitation_status | varchar | Loc declined |
| joined_at | timestamptz (nullable) | Fallback joinedAt |

### users

| Field | Type | Used for |
|---|---|---|
| id | UUID | Join key |
| full_name | varchar | Hien thi + search |
| email | varchar | Hien thi + search |
| avatar_url | varchar (nullable) | Hien thi avatar |
| department_id | UUID (nullable) | Join departments + filter |

### departments

| Field | Type | Used for |
|---|---|---|
| id | UUID | Join key |
| department_name | varchar | Hien thi |

### attendance_records

| Field | Type | Used for |
|---|---|---|
| meeting_id | UUID | Join key |
| user_id | UUID | Join key |
| check_in_time | timestamptz (nullable) | joinedAt priority 1 |
| attendance_status | varchar | Xac dinh presenceStatus |
| attendance_source | varchar | presenceSource |
| checkout_time | timestamptz (nullable) | Xac dinh left |
| updated_at | timestamptz | Chon record moi nhat |

### attendance_events

| Field | Type | Used for |
|---|---|---|
| meeting_id | UUID | Join key |
| user_id | UUID | Join key |
| event_type | varchar | event_type = check_in / enter_room |
| event_time | timestamptz | joinedAt priority 2 |

### presence_snapshots

| Field | Type | Used for |
|---|---|---|
| room_id | UUID | Join key (qua meeting.room_id) |
| user_id | UUID | Join key |
| presence_status | varchar | present, maybe_present |
| source | varchar | presenceSource (room_camera, door_checkin) |
| snapshot_time | timestamptz | lastSeenAt |
| confidence | float (nullable) | confidenceScore |
| metadata_json | jsonb | Data bo sung |

---

## 2. Query Strategy

### Main query (TypeORM QueryBuilder)

```
meeting_participants mp
  JOIN users u ON u.id = mp.user_id
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN LATERAL (
    SELECT * FROM attendance_records
    WHERE meeting_id = :meetingId AND user_id = mp.user_id
    ORDER BY updated_at DESC LIMIT 1
  ) ar ON true
  LEFT JOIN LATERAL (
    SELECT * FROM presence_snapshots
    WHERE room_id = :roomId AND user_id = mp.user_id
    ORDER BY snapshot_time DESC LIMIT 1
  ) ps ON true
WHERE mp.meeting_id = :meetingId
  AND mp.user_id IS NOT NULL
  AND mp.invitation_status IS DISTINCT FROM 'declined'
```

### PresenceStatus mapping logic

1. ps.presence_status = 'present' -> PRESENT
2. ar.attendance_status IN ('present','late') -> PRESENT
3. ps.presence_status = 'maybe_present' -> MAYBE_PRESENT
4. ar.check_in_time != null AND ar.checkout_time != null -> LEFT
5. ar.attendance_status = 'absent' -> ABSENT
6. Default -> UNKNOWN

### joinedAt mapping logic

1. ar.check_in_time
2. attendance_events.event_time (event_type = check_in hoac enter_room, earliest)
3. mp.joined_at
4. null (default)

---

## 3. Audit Log Schema

```typescript
{
  userId: currentUserId,
  actionType: 'read_live_participants',
  entityType: 'meeting',
  entityId: meetingId,
  newValueJson: {
    viewerUserId: currentUserId,
    viewerRole: 'host' | 'business_admin' | 'system_admin',
    resultCount: number,
    filters?: { search, departmentId },
  },
  ipAddress: string | null,
  userAgent: string | null,
  severity: 'info',
}
```
