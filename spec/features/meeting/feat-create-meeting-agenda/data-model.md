# Data Model: Tạo chương trình họp (UC-MM-09)

## Entity: meeting_agendas

**Không thay đổi schema.** Entity MeetingAgendaEntity đã có.

| Column | Type | Constraints | Ghi chú |
|---|---|---|---|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| meeting_id | uuid | FK -> meetings.id, NOT NULL | |
| agenda_order | integer | NOT NULL | Normalize từ array index + 1 |
| title | varchar(255) | NOT NULL | Trim trước khi lưu |
| description | text | NULLABLE | Max 2000 ký tự |
| owner_id | uuid | FK -> users.id, NULLABLE | Phải thuộc meeting_participants nếu có |
| planned_duration_minutes | integer | NULLABLE (DESIGN: NOT NULL trong spec) | > 0 |
| actual_duration_minutes | integer | NULLABLE | Out-of-scope |
| result_note | text | NULLABLE | Out-of-scope |
| status | varchar(30) | NOT NULL DEFAULT 'planned' | Không dùng DB enum |
| created_by | uuid | FK -> users.id, NULLABLE | Insert: currentUser.id |
| updated_by | uuid | FK -> users.id, NULLABLE | Insert: currentUser.id; Update: set updated_by |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | |

## Queries

### GET agendas:
```sql
SELECT a.*, u.display_name as owner_name
FROM meeting_agendas a
LEFT JOIN users u ON u.id = a.owner_id
WHERE a.meeting_id = :meetingId
ORDER BY a.agenda_order ASC;
```

### Atomic replace (transaction):
```sql
BEGIN;
-- Delete items not in request
DELETE FROM meeting_agendas WHERE meeting_id = :meetingId AND id NOT IN (:keepIds);
-- Update existing items
UPDATE meeting_agendas SET title = :t, description = :d, owner_id = :o, planned_duration_minutes = :p, agenda_order = :ao, updated_by = :u WHERE id = :id AND meeting_id = :meetingId;
-- Insert new items
INSERT INTO meeting_agendas (meeting_id, agenda_order, title, description, owner_id, planned_duration_minutes, status, created_by, updated_by) VALUES (...);
COMMIT;
```

## Audit log

INSERT INTO audit_logs (action, actor_id, target_type, target_id, old_value_json, new_value_json, severity) VALUES ('agenda_saved', :userId, 'meeting', :meetingId, :oldJson, :newJson, 'info');
