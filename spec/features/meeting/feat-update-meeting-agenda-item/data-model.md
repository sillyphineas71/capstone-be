# Data Model: Chỉnh sửa agenda item (UC-MM-10)

- **Feature ID**: UC-MM-10
- **Created**: 2026-07-17

---

## Entities

### MeetingAgendaEntity (UPDATE)

| Field | Type | Constraint | Usage trong PATCH |
|---|---|---|---|
| `id` | uuid | PK | Lookup theo path `agendaId` |
| `meeting_id` | uuid | FK → meetings.id | Lookup theo path `meetingId`, đảm bảo item thuộc đúng meeting |
| `agenda_order` | integer | NOT NULL | Update nếu request có `agendaOrder`; cũng update ở các item khác nếu bị shift |
| `title` | varchar(255) | NOT NULL | Update nếu request có `title` |
| `description` | text | nullable | Update nếu request có `description` (kể cả set `null`) |
| `owner_id` | uuid | FK → users.id, nullable | Update nếu request có `ownerId` (kể cả set `null`) |
| `planned_duration_minutes` | integer | nullable | Update nếu request có `plannedDurationMinutes` |
| `actual_duration_minutes` | integer | nullable | **Không đụng tới** (out of scope) |
| `result_note` | text | nullable | **Không đụng tới** (out of scope) |
| `status` | varchar(30) | default 'planned' | **Không đụng tới** (out of scope) |
| `created_by` | uuid | nullable | **Không đụng tới**, giữ nguyên |
| `updated_by` | uuid | nullable | Set = `currentUser.id` khi có thay đổi thực sự |
| `updated_at` | timestamptz | auto | TypeORM tự update khi UPDATE thành công |

**Operation chính**: `UPDATE meeting_agendas SET ... WHERE id = :agendaId AND meeting_id = :meetingId`

**Operation phụ (nếu agendaOrder đổi)**: `UPDATE meeting_agendas SET agenda_order = :newOrder WHERE id = :otherItemId` cho từng item bị shift (trong cùng transaction).

### MeetingEntity (READ ONLY + LOCK)

| Field | Type | Usage |
|---|---|---|
| `id` | uuid | Lookup, lock `pessimistic_write` |
| `status` | enum | Phải là `scheduled` |
| `organizer_id` | uuid | Authorization |
| `host_id` | uuid (nullable) | Authorization |
| `start_time` / `end_time` | timestamptz | Tính meeting duration cho overflow check |
| `deleted_at` | timestamptz (nullable) | Phải `NULL` |

### MeetingParticipantEntity (READ ONLY)

| Field | Type | Usage |
|---|---|---|
| `meeting_id` | uuid | Filter |
| `user_id` | uuid | Validate `ownerId` (nếu request có) thuộc tập này |

**Query**: `SELECT user_id FROM meeting_participants WHERE meeting_id = :meetingId` → dùng `getParticipantUserIds()` đã có từ UC-MM-09.

### AuditLogEntity (INSERT)

| Field | Value |
|---|---|
| `userId` | `currentUser.id` |
| `actionType` | `'agenda_item_updated'` |
| `entityType` | `'meeting_agenda'` |
| `entityId` | `agendaId` |
| `oldValueJson` | `{ <field đã đổi>: <giá trị cũ>, ... }` |
| `newValueJson` | `{ <field đã đổi>: <giá trị mới>, ..., reorderedAgendaIds?: string[] }` |
| `ipAddress` | Từ `ClientContext` |
| `userAgent` | Từ `ClientContext` |
| `severity` | `AuditLogSeverity.INFO` |

## State Transitions

```
meeting.status: scheduled → (PATCH agenda item) → scheduled (không đổi)
meeting_agendas.agenda_order: chỉ đổi trong phạm vi meeting hiện tại, luôn 1..N liên tục sau mỗi lần PATCH thành công
meeting_agendas.status: không đổi (out of scope), luôn giữ giá trị hiện có (mặc định 'planned' theo UC-MM-09)
```

## No Schema Changes

- Không thêm bảng mới.
- Không thêm cột mới.
- Không thêm enum value mới (dùng `AgendaStatus` đã có, không đụng tới field `status`).
