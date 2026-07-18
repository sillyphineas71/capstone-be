# Tasks: Xóa agenda item (UC-MM-11)

- **Feature ID**: UC-MM-11
- **Created**: 2026-07-17
- **Based on**: spec.md, plan.md, research.md, data-model.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks cho UC-MM-11 | Toàn bộ file |
| 2026-07-17 | Implement xong T001-T006 (DTO, service, controller, service/controller tests — 20 test case, tất cả pass). Regression check UC-MM-09/UC-MM-10 không phát sinh lỗi mới. Đánh dấu hoàn thành. | Mục Phase 1-4, checkbox `[x]` |

---

## Phase 1: Foundation — Response DTO

- [x] T001 [P] Tạo `DeleteAgendaItemResponseDto` tại `src/modules/meetings/dto/agenda-response.dto.ts`
  - Fields: `deleted: boolean`, `agendaId: string`, `meetingId: string`, `totalPlannedDurationMinutes: number`, `remainingDurationMinutes: number`, `remainingItemCount: number`
  - Constructor nhận data object + `Object.assign(this, data)` (giống pattern các response DTO khác trong file)
  - Outcome: Response DTO ready

## Phase 2: Service Business Logic

- [x] T002 Tạo helper `renormalizeAfterDelete(em, meetingId, deletedOrder)` trong `MeetingsService`
  - `UPDATE meeting_agendas SET agenda_order = agenda_order - 1 WHERE meeting_id = :meetingId AND agenda_order > :deletedOrder` (dùng `em.createQueryBuilder().update()` hoặc `em.decrement()`)
  - Outcome: Pure DB operation, tách riêng để dễ test

- [x] T003 Implement `deleteAgendaItem()` trong `src/modules/meetings/services/meetings.service.ts`
  - Signature: `async deleteAgendaItem(meetingId: string, agendaId: string, currentUserId: string, clientContext?: ClientContext): Promise<DeleteAgendaItemResponseDto>`
  - Steps (theo `plan.md` mục 7):
    1. `dataSource.transaction(async (em) => {...})`
    2. Lock meeting: `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })` → 404 `MEETING_NOT_FOUND` nếu không có/deleted
    3. `checkAgendaWritePermission(meeting, currentUserId)` (tái sử dụng)
    4. `validateMeetingStatusForAgendaWrite(meeting)` (tái sử dụng)
    5. Load agenda item: `em.findOne(MeetingAgendaEntity, { where: { id: agendaId, meetingId } })` → 404 `AGENDA_ITEM_NOT_FOUND` nếu null
    6. Snapshot item hiện tại (cho audit `old_value_json`)
    7. `em.delete(MeetingAgendaEntity, { id: agendaId })`
    8. Gọi `renormalizeAfterDelete(em, meetingId, item.agendaOrder)`
    9. Ghi `audit_logs` (`actionType: 'agenda_item_deleted'`, `entityType: 'meeting_agenda'`, `entityId: agendaId`, `oldValueJson: snapshot`, `newValueJson: null`)
    10. Load lại danh sách item còn lại (`em.find(MeetingAgendaEntity, { where: { meetingId }, order: { agendaOrder: 'ASC' } })`) để tính `remainingItemCount` và tổng duration
    11. Trả `DeleteAgendaItemResponseDto`
  - Outcome: DELETE endpoint logic hoàn chỉnh

## Phase 3: Controller & Routing

- [x] T004 Thêm DELETE endpoint trong `src/modules/meetings/controllers/meetings.controller.ts` (ngay sau khối `updateAgendaItem()` của UC-MM-10)
  - `@Delete(':meetingId/agendas/:agendaId')`
  - `@UseGuards(JwtAuthGuard)`
  - `@Param('meetingId', ParseUUIDPipe)`, `@Param('agendaId', ParseUUIDPipe)`
  - Gọi `meetingsService.deleteAgendaItem(meetingId, agendaId, currentUser.userId, clientContext)`
  - Response 200: `{ success: true, message: '...', data: DeleteAgendaItemResponseDto }`
  - Outcome: DELETE endpoint hoàn chỉnh

## Phase 4: Testing

- [x] T005 [P] Service tests cho `deleteAgendaItem()` tại `src/modules/meetings/tests/meetings.service.spec.ts`
  - TC-01: DELETE item ở giữa danh sách → item xóa, các item sau renormalize -1
  - TC-02: DELETE item cuối danh sách → không renormalize
  - TC-03: DELETE item duy nhất → `remainingItemCount = 0`
  - TC-04: DELETE bởi organizer → 200
  - TC-05: DELETE bởi participant thường → 403 AGENDA_WRITE_FORBIDDEN
  - TC-06: DELETE agendaId không tồn tại → 404 AGENDA_ITEM_NOT_FOUND
  - TC-07: DELETE agendaId thuộc meeting khác → 404 AGENDA_ITEM_NOT_FOUND, item của meeting khác không bị ảnh hưởng
  - TC-08: Double DELETE liên tiếp cùng agendaId → lần 1: 200, lần 2: 404
  - TC-09: DELETE trên meeting completed/cancelled/in_progress/pending_approval → 409 AGENDA_MEETING_STATUS_BLOCKED
  - TC-10: DELETE ghi audit log đúng (`old_value_json` snapshot đầy đủ, `new_value_json = null`)
  - TC-11: Transaction rollback khi lỗi (giả lập lỗi ở bước renormalize) → item được khôi phục, order không đổi
  - TC-12: DELETE không ảnh hưởng `agenda_order` của meeting khác

- [x] T006 [P] Controller tests tại `src/modules/meetings/controllers/meetings.controller.spec.ts`
  - DELETE trả 200 với format response đúng
  - DELETE trả 403 khi không có quyền
  - DELETE trả 404 khi agendaId không hợp lệ
  - DELETE trả 409 khi meeting không scheduled

---

## Requirements Coverage

| Task ID | FR liên quan | AC liên quan |
|---|---|---|
| T001 | FR-001 | AC-001 |
| T002 | FR-003 | AC-001, AC-003 |
| T003 | FR-001-008, FR-010-015 | AC-001-003, AC-006-011, AC-014 |
| T004 | FR-001, FR-010 | AC-004, AC-005 |
| T005 | FR-001-016 (phần lớn) | AC-001-014 |
| T006 | FR-010, FR-011, FR-013, FR-014 | AC-004, AC-006, AC-009 |

## Task Dependency Graph

```text
Phase 1: T001 (độc lập)
               |
Phase 2:       T002 [P] (pure function, độc lập)
               T003 (cần T001, T002)
               |
Phase 3:       T004 (cần T003)
               |
Phase 4:       T005 [P] (cần T003)
               T006 [P] (cần T004)
```

## Implementation Strategy

1. **MVP scope**: T001 → T002 → T003 → T004 (core logic + endpoint)
2. **Testing additions**: T005 → T006 (có thể parallel sau Phase 3)
3. **No seed permission needed**: dùng `meeting.agenda.write` đã có từ UC-MM-09
4. **No new tables/entity**: reuse `MeetingAgendaEntity`
5. **Regression check bắt buộc**: chạy lại test suite của UC-MM-09 (`replaceAgendas`) và UC-MM-10 (`updateAgendaItem`) sau khi thêm DELETE để đảm bảo không phá vỡ 2 endpoint hiện có
6. **Khuyến nghị thứ tự triển khai thực tế**: implement UC-MM-10 (PATCH) trước, UC-MM-11 (DELETE) sau, vì DELETE dùng chung error code `AGENDA_ITEM_NOT_FOUND` và pattern lock đã được thiết lập ở UC-MM-10
