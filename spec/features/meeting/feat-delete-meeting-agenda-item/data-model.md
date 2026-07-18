# Data Model: Xóa agenda item (UC-MM-11)

- **Feature ID**: UC-MM-11
- **Created**: 2026-07-17

---

## Entities

### MeetingAgendaEntity (DELETE + UPDATE)

| Field | Type | Constraint | Usage trong DELETE |
|---|---|---|---|
| `id` | uuid | PK | Lookup theo path `agendaId`, sau đó `DELETE` |
| `meeting_id` | uuid | FK → meetings.id | Lookup theo path `meetingId`, đảm bảo item thuộc đúng meeting; dùng để filter các item còn lại cần renormalize |
| `agenda_order` | integer | NOT NULL | Snapshot trước khi xóa; các item khác có `agenda_order` lớn hơn được `UPDATE agenda_order = agenda_order - 1` |
| `title`, `description`, `owner_id`, `planned_duration_minutes`, `status` | — | — | Chỉ đọc để snapshot vào `audit_logs.old_value_json`, không update |

**Operation chính**: `DELETE FROM meeting_agendas WHERE id = :agendaId AND meeting_id = :meetingId`

**Operation phụ (renormalize)**: `UPDATE meeting_agendas SET agenda_order = agenda_order - 1 WHERE meeting_id = :meetingId AND agenda_order > :deletedOrder` (trong cùng transaction).

### MeetingEntity (READ ONLY + LOCK)

| Field | Type | Usage |
|---|---|---|
| `id` | uuid | Lookup, lock `pessimistic_write` |
| `status` | enum | Phải là `scheduled` |
| `organizer_id` | uuid | Authorization |
| `host_id` | uuid (nullable) | Authorization |
| `start_time` / `end_time` | timestamptz | Dùng để tính `remainingDurationMinutes` trong response (không dùng để validate) |
| `deleted_at` | timestamptz (nullable) | Phải `NULL` |

### AuditLogEntity (INSERT)

| Field | Value |
|---|---|
| `userId` | `currentUser.id` |
| `actionType` | `'agenda_item_deleted'` |
| `entityType` | `'meeting_agenda'` |
| `entityId` | `agendaId` (item đã bị xóa) |
| `oldValueJson` | Snapshot đầy đủ item trước khi xóa: `{ id, agendaOrder, title, description, ownerId, plannedDurationMinutes, status }` |
| `newValueJson` | `null` |
| `ipAddress` | Từ `ClientContext` |
| `userAgent` | Từ `ClientContext` |
| `severity` | `AuditLogSeverity.INFO` |

## State Transitions

```
meeting.status: scheduled → (DELETE agenda item) → scheduled (không đổi)
meeting_agendas.agenda_order: các item sau item bị xóa dịch xuống 1 bậc, danh sách còn lại luôn 1..N liên tục
meeting_agendas row: tồn tại → (DELETE) → không còn tồn tại (hard delete, không phải trạng thái)
```

## No Schema Changes

- Không thêm bảng mới.
- Không thêm cột mới.
- Không cần `deleted_at` (xác nhận qua entity hiện có — hard delete phù hợp với thiết kế bảng).
