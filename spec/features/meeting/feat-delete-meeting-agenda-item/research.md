# Research: Xóa agenda item (UC-MM-11)

- **Feature ID**: UC-MM-11
- **Created**: 2026-07-17
- **Status**: Complete

---

## Codebase Analysis

### Tái sử dụng từ UC-MM-09 / UC-MM-10

| Thành phần | File | Ghi chú |
|---|---|---|
| `MeetingAgendaEntity` | `src/modules/meetings/entities/meeting-agenda.entity.ts` | Không có `deleted_at` — xác nhận DELETE phải là hard delete |
| `checkAgendaWritePermission()` | `meetings.service.ts` | Dùng nguyên |
| `validateMeetingStatusForAgendaWrite()` | `meetings.service.ts` | Dùng nguyên |
| Pessimistic lock pattern | `replaceAgendas()` (UC-MM-09), `updateAgendaItem()` (UC-MM-10) | DELETE phải tham gia cùng lock resource (`meetings` row) để 3 luồng ghi loại trừ lẫn nhau |
| Audit log write pattern | `replaceAgendas()` | Đổi `actionType = 'agenda_item_deleted'`, `newValueJson = null` |

### Kiểm tra FK phụ thuộc `meeting_agendas.id`

Rà soát Database v3.2 Compact (mục 5.2 của `CLAUDE.md`) và các entity trong `src/modules/meetings/entities/`: không có bảng nào khác có cột FK trỏ tới `meeting_agendas.id`. Do đó DELETE không cần cascade check hay xóa dữ liệu liên quan ở bảng khác — khác với UC-MM-08 (remove participant) vốn phải check `meeting_agendas.owner_id` trước khi xóa participant.

### API Contract gốc (`docs/API_CONTRACT_v1.0_with_system_roles.md`)

UC-29 (dòng 1314-1327) đặc tả DELETE với permission `meeting.agenda.delete` riêng và response tối giản `{ success, data: { deleted, agendaId } }`. Theo quyết định đã áp dụng nhất quán cho cả UC-MM-10/UC-MM-11: dùng permission gộp `meeting.agenda.write`, và response theo chuẩn `{ success, message, data }` của toàn dự án (CLAUDE.md mục 8.1), mở rộng thêm `meetingId`/`totalPlannedDurationMinutes`/`remainingDurationMinutes`/`remainingItemCount` để FE không cần gọi lại `GET /agendas` sau khi xóa.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Delete semantics | Hard delete | `meeting_agendas` không có `deleted_at`, đồng nhất với cách UC-MM-09 xóa item trong atomic replace |
| Lock strategy | `pessimistic_write` trên `meetings` row, dùng chung với PUT/PATCH | Nhất quán 3 endpoint, đơn giản hơn optimistic locking |
| Idempotency | Lần 2 trả 404, không trả 200 giả | Giúp FE/QA phát hiện double-submit hoặc race condition rõ ràng, tránh false-positive success |
| Renormalize | Shift-left đơn giản (chỉ item có order lớn hơn item bị xóa) | Đơn giản hơn nhiều so với thuật toán "move" của PATCH — không cần tính toán vị trí đích |
| Duration overflow check | Bỏ qua (không cần) | Xóa item luôn làm giảm tổng, không thể gây overflow |

## Risks Identified

1. Nếu không lock đúng cách, 2 DELETE liên tiếp rất nhanh (double-click) trên cùng `agendaId` có thể cả hai đều đọc thấy item tồn tại trước khi transaction đầu tiên commit — transaction lock ở mức `meetings` row (không phải row-level trên `meeting_agendas`) giải quyết được vì cả hai phải tuần tự hóa qua cùng 1 lock.
2. Cần đảm bảo renormalize chỉ áp dụng cho item **trong cùng meeting** (`WHERE meeting_id = :meetingId AND agenda_order > :deletedOrder`), tránh ảnh hưởng nhầm sang meeting khác.
3. Response cần trả `remainingItemCount` để FE biết agenda đã trống hay chưa mà không cần gọi thêm `GET /agendas`.

## Dependencies

- Không có dependency mới ngoài module `meetings` hiện có.
- Không cần seed permission mới (dùng `meeting.agenda.write` đã tồn tại).
- Phụ thuộc quy ước error code `AGENDA_ITEM_NOT_FOUND` được định nghĩa lần đầu ở UC-MM-10 — cần dùng chung constant, tránh định nghĩa lệch giữa 2 feature.
