# Tasks: Chỉnh sửa agenda item (UC-MM-10)

- **Feature ID**: UC-MM-10
- **Created**: 2026-07-17
- **Based on**: spec.md, plan.md, research.md, data-model.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks cho UC-MM-10 | Toàn bộ file |
| 2026-07-17 | Implement xong T001-T009 (DTO, service, controller, DTO/service/controller tests — 37 test case, tất cả pass). Đánh dấu hoàn thành. | Mục Phase 1-4, checkbox `[x]` |

---

## Phase 1: Foundation — DTO & Validation

- [x] T001 [P] Tạo `UpdateAgendaItemDto` tại `src/modules/meetings/dto/update-agenda-item.dto.ts`
  - Fields: `title?`, `description?`, `ownerId?: string | null`, `plannedDurationMinutes?`, `agendaOrder?`
  - Toàn bộ `@IsOptional()`; `ownerId` cần cho phép `null` tường minh (`@ValidateIf` hoặc custom logic)
  - `whitelist: true` + `forbidNonWhitelisted: true` ở `ValidationPipe` cấp controller đảm bảo field lạ (`status`, ...) bị reject 400
  - Outcome: DTO input class ready

- [x] T002 [P] Mở rộng response DTO tại `src/modules/meetings/dto/agenda-response.dto.ts`
  - Thêm `AgendaItemUpdateResponseDto` kế thừa/mở rộng `AgendaItemResponseDto` với `updatedAt`, `totalPlannedDurationMinutes`, `remainingDurationMinutes`
  - Outcome: Response DTO ready

## Phase 2: Service Business Logic

- [x] T003 Tạo helper `isAgendaUpdatePayloadEmpty(dto)` trong `MeetingsService`
  - Trả `true` nếu mọi field của DTO đều `undefined`
  - Gọi ngay đầu `updateAgendaItem()`, throw `BadRequestException('AGENDA_UPDATE_PAYLOAD_EMPTY')` nếu true

- [x] T004 Tạo helper `computeAgendaOrderShift(items, itemId, newOrder)` trong `MeetingsService`
  - Input: danh sách item hiện tại (sorted theo `agendaOrder`), id item đang sửa, `newOrder` mong muốn
  - Output: map `{ agendaId: newOrderValue }` cho tất cả item bị ảnh hưởng (bao gồm chính item đang sửa)
  - Validate `newOrder` trong khoảng `[1, items.length]`, nếu không → throw `UnprocessableEntityException('AGENDA_INVALID_ORDER')`
  - Outcome: Pure function, dễ unit test độc lập

- [x] T005 Implement `updateAgendaItem()` trong `src/modules/meetings/services/meetings.service.ts`
  - Signature: `async updateAgendaItem(meetingId: string, agendaId: string, dto: UpdateAgendaItemDto, currentUserId: string, clientContext?: ClientContext): Promise<AgendaItemUpdateResponseDto>`
  - Steps (theo `plan.md` mục 7):
    1. `isAgendaUpdatePayloadEmpty()` check (fail fast trước transaction)
    2. `dataSource.transaction(async (em) => {...})`
    3. Lock meeting: `em.findOne(MeetingEntity, { where: { id: meetingId }, lock: { mode: 'pessimistic_write' } })` → 404 nếu không có/deleted
    4. `checkAgendaWritePermission(meeting, currentUserId)` (tái sử dụng từ UC-MM-09)
    5. `validateMeetingTimeForAgenda(meeting)`, `validateMeetingStatusForAgendaWrite(meeting)` (tái sử dụng)
    6. Load agenda item: `em.findOne(MeetingAgendaEntity, { where: { id: agendaId, meetingId } })` → 404 `AGENDA_ITEM_NOT_FOUND` nếu null
    7. Field validation cho field có mặt trong `dto` (title/description/duration) — tái sử dụng logic tương tự `validateReplaceAgendaRequest` nhưng chỉ áp dụng cho field có mặt
    8. Nếu `dto.ownerId !== undefined && dto.ownerId !== null`: validate thuộc `getParticipantUserIds(meetingId)`
    9. No-op check: so sánh field có mặt trong `dto` với giá trị hiện tại của item → nếu tất cả giống hệt, trả response hiện tại, không UPDATE, không audit
    10. Nếu `dto.agendaOrder !== undefined`: gọi `computeAgendaOrderShift()`, `em.update()` cho từng item bị ảnh hưởng
    11. Tính tổng `plannedDurationMinutes` mới (toàn bộ agenda, item đang sửa dùng giá trị mới nếu có) → so với `getMeetingDurationMinutes(meeting)` → 422 nếu overflow
    12. `em.update(MeetingAgendaEntity, { id: agendaId }, { ...changedFields, updatedBy: currentUserId })`
    13. Ghi `audit_logs` (`actionType: 'agenda_item_updated'`, `entityType: 'meeting_agenda'`, `entityId: agendaId`, diff old/new)
    14. Reload item (+ `owner` relation) để build response
  - Outcome: PATCH endpoint logic hoàn chỉnh

## Phase 3: Controller & Routing

- [x] T006 Thêm PATCH endpoint trong `src/modules/meetings/controllers/meetings.controller.ts` (ngay sau khối `replaceAgendas()`)
  - `@Patch(':meetingId/agendas/:agendaId')`
  - `@UseGuards(JwtAuthGuard)`
  - `@Param('meetingId', ParseUUIDPipe)`, `@Param('agendaId', ParseUUIDPipe)`
  - `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
  - Gọi `meetingsService.updateAgendaItem(meetingId, agendaId, dto, currentUser.userId, clientContext)`
  - Response 200: `{ success: true, message: '...', data: AgendaItemUpdateResponseDto }`
  - Outcome: PATCH endpoint hoàn chỉnh

## Phase 4: Testing

- [x] T007 [P] DTO validation tests tại `src/modules/meetings/tests/meetings.service.spec.ts`
  - `title` > 255 → error; `description` > 2000 → error; `plannedDurationMinutes` <= 0 hoặc không integer → error; `ownerId` invalid UUID (không null) → error; `agendaOrder` không integer → error
  - Body toàn `undefined` vẫn pass DTO-level (business check `isAgendaUpdatePayloadEmpty` xử lý ở service)

- [x] T008 [P] Service tests cho `updateAgendaItem()`
  - TC-01: PATCH chỉ title → chỉ title đổi
  - TC-02: PATCH chỉ plannedDurationMinutes (không overflow) → cập nhật đúng
  - TC-03: PATCH ownerId hợp lệ → ownerName resolve đúng
  - TC-04: PATCH ownerId = null → un-assign
  - TC-05: PATCH agendaOrder di chuyển lên → các item liên quan renormalize đúng
  - TC-06: PATCH agendaOrder di chuyển xuống → các item liên quan renormalize đúng
  - TC-07: PATCH nhiều field cùng lúc → tất cả đổi đúng
  - TC-08: PATCH ownerId không thuộc participants → 422 AGENDA_OWNER_NOT_PARTICIPANT
  - TC-09: PATCH title rỗng sau trim → 422 AGENDA_TITLE_REQUIRED
  - TC-10: PATCH title > 255 → 422 AGENDA_TITLE_TOO_LONG
  - TC-11: PATCH description > 2000 → 422 AGENDA_DESCRIPTION_TOO_LONG
  - TC-12: PATCH gây duration overflow → 422 AGENDA_DURATION_OVERFLOW
  - TC-13: PATCH agendaOrder ngoài khoảng → 422 AGENDA_INVALID_ORDER
  - TC-14: PATCH body rỗng → 400 AGENDA_UPDATE_PAYLOAD_EMPTY
  - TC-15: PATCH agendaId không tồn tại → 404 AGENDA_ITEM_NOT_FOUND
  - TC-16: PATCH agendaId thuộc meeting khác → 404 AGENDA_ITEM_NOT_FOUND
  - TC-17: PATCH meeting không scheduled (pending_approval/in_progress/completed/cancelled) → 409 AGENDA_MEETING_STATUS_BLOCKED
  - TC-18: PATCH bởi participant thường → 403 AGENDA_WRITE_FORBIDDEN
  - TC-19: PATCH no-op → 200, không đổi `updated_at`, không audit log mới
  - TC-20: PATCH ghi audit log đúng `actionType`/diff
  - TC-21: Transaction rollback khi lỗi → item giữ nguyên giá trị cũ

- [x] T009 [P] Controller tests tại `src/modules/meetings/controllers/meetings.controller.spec.ts`
  - PATCH trả 200 với format response đúng
  - PATCH trả 403 khi không có quyền
  - PATCH trả 400 khi field ngoài whitelist (`status`)
  - PATCH trả 400 khi body rỗng

---

## Requirements Coverage

| Task ID | FR liên quan | AC liên quan |
|---|---|---|
| T001 | FR-002, FR-003, FR-019-022, FR-025-026 | AC-011, AC-012 |
| T002 | FR-001 | AC-001 |
| T003 | FR-027 | AC-011 |
| T004 | FR-004, FR-025 | AC-002 |
| T005 | FR-001, FR-004-009, FR-014-024, FR-028 | AC-001-003, AC-006-010, AC-013-015 |
| T006 | FR-001, FR-013 | AC-004, AC-005 |
| T007 | FR-019-022, FR-025 | AC-012 |
| T008 | FR-001-029 (phần lớn) | AC-001-015 |
| T009 | FR-013, FR-014, FR-026, FR-027 | AC-004, AC-011, AC-012 |

## Task Dependency Graph

```text
Phase 1: T001 ── T002 (parallel [P])
               |
Phase 2:       T003 [P] (fail-fast check, độc lập)
               T004 [P] (pure function, độc lập)
               T005 (cần T001, T002, T003, T004)
               |
Phase 3:       T006 (cần T005)
               |
Phase 4:       T007 [P] (cần T001)
               T008 [P] (cần T005)
               T009 [P] (cần T006)
```

## Implementation Strategy

1. **MVP scope**: T001 → T002 → T003 → T004 → T005 → T006 (core logic + endpoint)
2. **Testing additions**: T007 → T008 → T009 (có thể parallel sau Phase 3)
3. **No seed permission needed**: dùng `meeting.agenda.write` đã có từ UC-MM-09
4. **No new tables/entity**: reuse `MeetingAgendaEntity`
5. **Regression check bắt buộc**: chạy lại test suite của UC-MM-09 (`replaceAgendas`) sau khi thêm PATCH để đảm bảo không phá vỡ PUT hiện có
