# Data Model - Xem danh sach toan bo booking phong hien tai

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi data-model cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-21 | Fix meeting_id nullable: entity thuc te la non-nullable (onDelete CASCADE), sua tu "uuid FK null" thanh "uuid FK" | Dong meeting_id |

---

## Entities Lien Quan

### 1. room_bookings (RoomBookingEntity)

| Field | Type | SELECT | Filter | Sort | Notes |
|-------|------|:------:|:------:|:----:|-------|
| id | uuid PK | Y | | | Response field |
| booking_code | varchar(80) | Y | q (ILIKE) | | Response field |
| booking_type | varchar(30) | Y | Y | | Response field, enum BookingType |
| meeting_id | uuid FK | Y | | | Join to meetings (non-nullable, onDelete CASCADE). LEFT JOIN van dung de phong orphan data |
| room_id | uuid FK | Y | Y | | Join to rooms |
| reserved_start_time | timestamptz | Y | from/to | Y | Default sort DESC |
| reserved_end_time | timestamptz | Y | | | Response field |
| status | varchar(30) | Y | Y | Y | Response field, enum RoomBookingStatus |
| booked_by | uuid FK | Y | | | Join to users |
| approved_by | uuid FK null | Y | | | Join to users |
| approved_at | timestamptz null | Y | | | Response field |
| cancellation_reason | text null | Y | | | Response field |
| created_at | timestamptz | Y | | Y | Response field |
| updated_at | timestamptz | Y | | | Response field |

### 2. rooms (RoomEntity)

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| room_name | Y | room.roomName |

### 3. meetings (MeetingEntity)

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | Y | meeting.id |
| title | Y | meeting.title |

### 4. users (UserEntity) - for bookedByUser

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| full_name | Y | bookedByUser.fullName |
| email | Y | bookedByUser.email |

### 5. users (UserEntity) - for approvedByUser

| Field | SELECT | Notes |
|-------|:------:|-------|
| id | | FK reference |
| full_name | Y | approvedByUser.fullName (nullable) |
| email | Y | approvedByUser.email (nullable) |

