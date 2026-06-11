# Data Model: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Created**: 2026-06-10

---

## 1. Entity Impact

### 1.1 Entities sử dụng (READ)

| Entity / Table | Fields đọc | Mục đích |
|---|---|---|
| `meetings` | `id`, `status`, `visibility_level`, `organizer_id`, `host_id`, `room_id`, `start_time`, `end_time` | Kiểm tra trạng thái, quyền, phòng, thời gian |
| `users` | `id`, `account_status` | Kiểm tra user tồn tại và active |
| `rooms` | `id`, `capacity` | Kiểm tra sức chứa phòng |
| `meeting_participants` | `meeting_id`, `user_id`, `participant_role` | Kiểm tra duplicate, đếm số lượng |
| `system_configs` | `config_value` WHERE `config_key = 'meeting.capacity_policy'` | Đọc policy capacity (`warning` / `block`) |
| `roles` / `permissions` / `user_roles` / `role_permissions` | Query qua `AuthzReadRepository` | Kiểm tra quyền override capacity |

### 1.2 Entities ghi (CREATE)

| Entity / Table | Action | Fields ghi |
|---|---|---|
| `meeting_participants` | INSERT | `meeting_id`, `user_id`, `participant_role='attendee'`, `invitation_status='pending'`, `attendance_required=true`, `is_required=true`, `invited_by=[Actor.id]` |
| `notifications` | INSERT | `notification_type='MEETING_INVITE'`, `channel`, `subject`, `content`, `related_entity_type='meeting'`, `related_entity_id`, `recipient_scope='user_list'`, `recipient_user_ids_json=[userId]`, `delivery_status='QUEUED'`, `created_by` |
| `background_jobs` | INSERT | `job_type='SEND_EMAIL'`, `related_entity_type='meeting'`, `related_entity_id`, `status='QUEUED'`, `input_json={notificationId, template:'meeting_invite'}`, `requested_by` |
| `audit_logs` | INSERT | `user_id`, `action_type='ADD_PARTICIPANT'`, `entity_type='meeting_participant'`, `entity_id`, `new_value_json={userId, meetingId, invitedBy}`, `ip_address`, `user_agent`, `severity='INFO'` |

---

## 2. Không thay đổi Schema

Feature này **KHÔNG thay đổi database schema**. Tất cả entities đã tồn tại trong v3.2 Compact (39 tables).

---

## 3. Unique Constraints

- `meeting_participants`: UNIQUE `(meeting_id, user_id)` — đã tồn tại trong DB, dùng để catch race condition (FR-013)

---

## 4. State Machine cho Meeting Status

Chỉ cho phép add participant khi:

```
scheduled ──→ in_progress ──→ completed
    │                            ↑
    └── cancelled ───────────────┘
         (không cho phép)
```

- **Allowed**: `scheduled`, `in_progress`
- **Blocked**: `draft`, `pending_approval`, `completed`, `cancelled`

---

## 5. warningToken Data Flow

### Structure (JWT payload):
```json
{
  "sub": "warning:meet-add-participant",
  "meetingId": "uuid",
  "userId": "uuid",
  "warnings": [
    { "type": "SCHEDULE_CONFLICT", "message": "..." },
    { "type": "ROOM_CAPACITY_WARNING", "message": "..." }
  ],
  "iat": 1718000000,
  "exp": 1718000300
}
```

### Scope:
- Token chỉ có tác dụng với đúng `meetingId` + `userId` đã ghi trong payload
- TTL: 5 phút
- Signed bằng `WARNING_TOKEN_SECRET` (riêng biệt với JWT access token secret)
- Verification: verify signature + match `meetingId` + `userId` + check `exp`

---

## 6. Redis / Cache Không dùng

Feature này không dùng Redis/cache. `warningToken` là self-contained JWT, không cần server-side storage.
