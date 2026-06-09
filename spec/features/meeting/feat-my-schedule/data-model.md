# Data Model: UC-MM-05 Tra cứu lịch trình cá nhân

## 1. Entities (READ-ONLY)

Feature này chỉ đọc dữ liệu từ database. Không tạo/ sửa/ xóa bất kỳ entity nào.

### 1.1 meetings

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | meetingId trong response |
| `meeting_code` | varchar(80) | meetingCode trong response, search bởi q |
| `title` | varchar(500) | Tiêu đề hiển thị, search bởi q |
| `organizer_id` | uuid (FK → users) | Xác định relationship, effectiveUserRole |
| `host_id` | uuid (FK → users, nullable) | Xác định relationship, effectiveUserRole |
| `room_id` | uuid (FK → rooms, nullable) | Lọc roomId, hiển thị room info |
| `status` | varchar(50) | scheduled, in_progress, cancelled, completed |
| `start_time` | timestamptz | Overlap query, display |
| `end_time` | timestamptz | Overlap query, display |
| `timezone` | varchar(100) | Timezone metadata |
| `recurrence_rule_id` | uuid (FK, nullable) | Recurring meeting indicator |
| `parent_meeting_id` | uuid (FK, nullable) | Recurring meeting indicator |
| `description` | text | Popup detail |
| `deleted_at` | timestamptz (nullable) | Soft delete filter |

### 1.2 meeting_participants

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `meeting_id` | uuid (FK → meetings) | Join key |
| `user_id` | uuid (FK → users) | Xác định relationship |
| `participant_role` | varchar(50) | Popup detail |
| `invitation_status` | varchar(50) | Popup detail |
| `attendance_status` | varchar(50) | Popup detail |

### 1.3 rooms

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | room.id trong response |
| `room_name` | varchar(200) | Hiển thị |
| `room_code` | varchar(50) | Hiển thị |
| `site_name` | varchar(200) | Location info |
| `area_name` | varchar(200) | Location info |
| `location_description` | text | Location info |

### 1.4 room_bookings

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `meeting_id` | uuid (FK → meetings) | Join key |
| `room_id` | uuid (FK → rooms) | — |
| `reserved_start_time` | timestamptz | Popup detail (read-only) |
| `reserved_end_time` | timestamptz | Popup detail (read-only) |
| `status` | varchar(50) | Popup detail (read-only) |

### 1.5 meeting_agendas

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `meeting_id` | uuid (FK → meetings) | Join key |
| `title` | varchar(500) | Popup detail |
| `duration_minutes` | integer | Popup detail |
| `sort_order` | integer | Sorting |

### 1.6 meeting_external_participants

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `meeting_id` | uuid (FK → meetings) | Join key |
| `name` | varchar(200) | Popup detail |
| `email` | varchar(200) | Popup detail |

### 1.7 media_files

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `reference_type` | varchar(50) | Filter: 'meeting' |
| `reference_id` | uuid | Join: meeting.id |
| `file_name` | varchar(500) | Attachment display |
| `file_url` | text | Download link |
| `file_type` | varchar(200) | MIME type |
| `file_size` | bigint | File size in bytes |

### 1.8 recording_configs

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `meeting_id` | uuid (FK → meetings) | Join key |
| `auto_record` | boolean | Popup detail (read-only) |
| `allow_recording` | boolean | Popup detail (read-only) |

### 1.9 users

| Field | Type | Usage |
|---|---|---|
| `id` | uuid (PK) | — |
| `full_name` | varchar(200) | Popup detail |
| `email` | varchar(200) | Popup detail |

## 2. Key Queries

### 2.1 Schedule List (getMySchedule)

```sql
SELECT
  m.id,
  m.meeting_code,
  m.title,
  m.start_time,
  m.end_time,
  m.timezone,
  m.status,
  CASE
    WHEN m.organizer_id = :userId THEN 'organizer'
    WHEN m.host_id = :userId THEN 'host'
    ELSE 'attendee'
  END AS effective_user_role,
  r.id AS room_id,
  r.room_name,
  r.room_code,
  r.location_description,
  r.site_name,
  r.area_name
FROM meetings m
LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = :userId
LEFT JOIN rooms r ON r.id = m.room_id
WHERE (m.organizer_id = :userId OR m.host_id = :userId OR mp.id IS NOT NULL)
  AND m.status NOT IN ('draft', 'pending_approval')
  AND m.start_time < :to
  AND m.end_time > :from
  AND m.deleted_at IS NULL
  [AND m.status = ANY(:status)]
  [AND effective_user_role = :role]
  [AND m.room_id = :roomId]
  [AND (m.title ILIKE :q OR m.meeting_code ILIKE :q)]
GROUP BY m.id, r.id, effective_user_role
ORDER BY m.start_time ASC
```

### 2.2 Schedule Detail (getMyScheduleDetail)

```sql
-- 1. Load meeting + organizer + host
SELECT m.*, u1.full_name AS org_name, u1.email AS org_email,
       u2.full_name AS host_name, u2.email AS host_email
FROM meetings m
LEFT JOIN users u1 ON u1.id = m.organizer_id
LEFT JOIN users u2 ON u2.id = m.host_id
WHERE m.id = :meetingId AND m.deleted_at IS NULL;

-- 2. Check participant relationship
SELECT 1 FROM meeting_participants
WHERE meeting_id = :meetingId AND user_id = :userId
LIMIT 1;

-- 3. Room info
SELECT * FROM rooms WHERE id = :roomId;

-- 4. Participants
SELECT mp.*, u.full_name, u.email
FROM meeting_participants mp
JOIN users u ON u.id = mp.user_id
WHERE mp.meeting_id = :meetingId;

-- 5. External participants
SELECT * FROM meeting_external_participants
WHERE meeting_id = :meetingId;

-- 6. Agendas
SELECT * FROM meeting_agendas
WHERE meeting_id = :meetingId
ORDER BY sort_order ASC;

-- 7. Attachments (media_files)
SELECT * FROM media_files
WHERE reference_type = 'meeting' AND reference_id = :meetingId;

-- 8. Recording config
SELECT * FROM recording_configs
WHERE meeting_id = :meetingId
LIMIT 1;
```

## 3. State Transitions

Feature này READ-ONLY — không có state transition nào.

## 4. Permission Data

New seed data needed in addition to existing seed:

```sql
INSERT INTO permissions (id, code, name, description, created_at)
VALUES (gen_random_uuid(), 'schedule.read.self', 'Xem lịch cá nhân',
        'Cho phép người dùng xem lịch trình cá nhân của chính mình', NOW());

-- Assign to admin role
INSERT INTO role_permissions (id, role_id, permission_id)
SELECT gen_random_uuid(), r.id, p.id
FROM roles r, permissions p
WHERE r.name IN ('admin', 'manager', 'employee')
  AND p.code = 'schedule.read.self';
```

## 5. Current-time Logic (Frontend)

`isCurrent` và `isPast` được tính trong backend dựa trên `NOW()` tại thời điểm request:

```sql
-- isCurrent
CASE WHEN NOW() BETWEEN m.start_time AND m.end_time THEN true ELSE false END AS is_current
-- isPast
CASE WHEN m.end_time < NOW() THEN true ELSE false END AS is_past
```

Frontend có thể tự refresh hoặc tính lại `isCurrent`/`isPast` dựa trên `startTime`/`endTime` nhận được.
