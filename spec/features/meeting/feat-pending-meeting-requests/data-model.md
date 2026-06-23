# Data Model - Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

## Entities Liên Quan

### 1. meeting_requests (MeetingRequestEntity)

| Field | Type | SELECT | Filter | Sort | Notes |
|-------|------|:------:|:------:|:----:|-------|
| id | uuid PK | Y | | | Response field |
| request_code | varchar(80) | Y | q (ILIKE) | | Response field |
| request_type | varchar(40) | Y | Y | Y | Response field |
| requested_by | uuid FK | Y | Y | | Join to users |
| requested_at | timestamptz | Y | from/to | Y | Default sort DESC |
| target_room_id | uuid FK null | Y | Y | | Join to rooms |
| meeting_id | uuid FK null | Y | | | Join to meetings |
| requested_start_time | timestamptz null | Y | | | Response field |
| requested_end_time | timestamptz null | Y | | | Response field |
| approval_status | varchar(30) | Y | Y | Y | Default filter = pending |
| conflict_check_status | varchar(30) | Y | | | Response field |
| conflict_summary_json | jsonb null | Y | | | Raw JSON |
| decision_by | uuid null | Y | | | Join to users |
| decision_at | timestamptz null | Y | | | Response field |
| rejection_reason | text null | Y | | | Response field |

### 2. users (UserEntity)

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| full_name | Y | requestedBy.fullName |
| email | Y | requestedBy.email |
| department_id | | FK → departments.id, nullable. Dùng cho scope filtering |
| direct_manager_id | | FK → users.id, nullable. Dùng cho scope filtering |

### 3. rooms (RoomEntity)

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| room_name | Y | targetRoom.roomName |

### 4. meetings (MeetingEntity)

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| title | Y | meeting.title |
