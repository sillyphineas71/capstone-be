# Implementation Plan: Xóa agenda item (UC-MM-11)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Tạo plan lần đầu cho UC-MM-11 | Toàn bộ file |

---

- **Feature ID**: UC-MM-11 (UC-29)
- **Plan Version**: 1.0
- **Based on Spec**: `spec.md` (v2026-07-17)
- **Target Module**: `meetings`
- **Depends on**: UC-MM-09 (`feat-create-meeting-agenda`), UC-MM-10 (`feat-update-meeting-agenda-item`) — dùng chung `checkAgendaWritePermission`, `validateMeetingStatusForAgendaWrite`, lock pattern, `getMeetingDurationMinutes`

---

## 1. Feature Summary

Bổ sung `DELETE /api/v1/meetings/{meetingId}/agendas/{agendaId}` để xóa **một** agenda item cụ thể (hard delete + renormalize order), tồn tại song song với `PUT /agendas` (UC-MM-09) và `PATCH /agendas/{agendaId}` (UC-MM-10). Cả ba luồng ghi dùng chung `checkAgendaWritePermission()` và lock `meetings` row (`pessimistic_write`) trong transaction.

## 2. Technical Context

### 2.1 Tech Stack

Giống UC-MM-09/UC-MM-10: NestJS, TypeORM, PostgreSQL, JWT (`JwtAuthGuard`), `class-validator`.

### 2.2 Existing Codebase Analysis

| File | Vai trò | Tái sử dụng |
|---|---|---|
| `src/modules/meetings/entities/meeting-agenda.entity.ts` | `MeetingAgendaEntity` | Dùng nguyên |
| `src/modules/meetings/services/meetings.service.ts` | `checkAgendaWritePermission()`, `validateMeetingStatusForAgendaWrite()`, `getMeetingDurationMinutes()` | Tái sử dụng trực tiếp |
| `src/modules/meetings/controllers/meetings.controller.ts` | Chứa `getAgendas()`, `replaceAgendas()`, (và `updateAgendaItem()` từ UC-MM-10) | Thêm handler `deleteAgendaItem()` ngay sau `updateAgendaItem()` |
| `AuditLogEntity` | Field convention giống UC-MM-09/UC-MM-10 | Đổi `actionType = 'agenda_item_deleted'` |

### 2.3 Điểm khác biệt so với PUT/PATCH

- Không có request body — chỉ path params.
- Không cần validate duration overflow (xóa luôn giảm tổng).
- Renormalize luôn là shift-left đơn giản (giảm order của các item phía sau đi 1), không cần thuật toán "move" phức tạp như PATCH.

## 3. Scope Confirmation

### In scope

- `DELETE /meetings/{meetingId}/agendas/{agendaId}` — hard delete 1 item.
- Renormalize `agenda_order` của các item còn lại (shift-left).
- Audit log riêng (`agenda_item_deleted`) với snapshot item bị xóa.
- Dùng chung lock resource với PUT/PATCH.
- Idempotency: gọi lần 2 trên cùng `agendaId` → 404.

### Out of scope

- Soft delete / undo.
- Bulk DELETE nhiều item (dùng PUT).
- Notification/email.
- Cascade delete ở bảng khác (không có FK nào trỏ tới `meeting_agendas.id`).

## 4. Data Model Impact

```
meeting_agendas   → DELETE (1 item) + UPDATE (agenda_order của các item phía sau, shift-left)
meetings          → READ ONLY (status, organizer_id, host_id) + LOCK (pessimistic_write)
audit_logs        → INSERT (action_type = 'agenda_item_deleted')
```

Không thêm bảng, không thêm cột.

## 5. API / Contract Plan

Xem `contracts/delete-agenda-item-api.md`.

## 6. Authorization Plan

Tái sử dụng `checkAgendaWritePermission(meeting, userId)` — không tạo permission mới.

## 7. Business Logic Plan

### Core flow

```
1. Validate meetingId, agendaId là UUID hợp lệ (ParseUUIDPipe trên controller)
2. BEGIN TRANSACTION
3. Load meeting với pessimistic_write lock → 404 nếu không tồn tại/deleted
4. checkAgendaWritePermission() → 403 nếu không có quyền
5. validateMeetingStatusForAgendaWrite() → 409 nếu không scheduled
6. Load agenda item theo id + meetingId → 404 AGENDA_ITEM_NOT_FOUND nếu không có
7. Snapshot item (cho audit old_value_json)
8. DELETE agenda item
9. Load các item còn lại có agenda_order > item.agendaOrder, UPDATE agenda_order -= 1 cho từng item
10. INSERT audit_logs (action_type = 'agenda_item_deleted', old_value_json = snapshot, new_value_json = null)
11. COMMIT TRANSACTION
12. Tính tổng plannedDurationMinutes còn lại (cho response, không validate)
13. Trả 200 với { deleted: true, agendaId, meetingId, totalPlannedDurationMinutes, remainingDurationMinutes, remainingItemCount }
```

### Edge cases

- Item là item cuối (order = N): không có item nào cần shift, bước 9 no-op.
- Xóa hết toàn bộ item: cho phép, `remainingItemCount = 0`.
- Double DELETE liên tiếp: lần 2 item không còn ở bước 6 → 404.

## 8. Validation Plan

### Path params

| Field | Rule |
|---|---|
| `meetingId` | `ParseUUIDPipe` |
| `agendaId` | `ParseUUIDPipe` |

Không có body — không cần DTO validation cho request.

### Business validation

Xem bảng mục 8.2 trong `spec.md`.

## 9. Error Handling Plan

- Transaction fail → rollback toàn bộ (item được khôi phục, order không đổi) → lỗi tương ứng hoặc 500.
- Audit log ghi trong cùng transaction với DELETE (không best-effort, giống UC-MM-10 — thao tác nhanh, không async side-effect).

## 10. Testing Strategy

### Unit tests (Service)

| Test | Expected |
|---|---|
| DELETE item ở giữa danh sách | 200, item bị xóa, các item sau renormalize -1 |
| DELETE item cuối danh sách | 200, không có item nào renormalize |
| DELETE item duy nhất còn lại | 200, agenda trở thành rỗng |
| DELETE bởi participant thường | 403 AGENDA_WRITE_FORBIDDEN |
| DELETE chưa đăng nhập | 401 UNAUTHORIZED |
| DELETE agendaId không tồn tại | 404 AGENDA_ITEM_NOT_FOUND |
| DELETE agendaId thuộc meeting khác | 404 AGENDA_ITEM_NOT_FOUND |
| DELETE 2 lần liên tiếp cùng agendaId | Lần 1: 200, lần 2: 404 |
| DELETE meeting completed/cancelled/in_progress/pending_approval | 409 AGENDA_MEETING_STATUS_BLOCKED |
| DELETE ghi audit log đúng snapshot | old_value_json chứa đầy đủ field item cũ, new_value_json = null |
| DELETE transaction rollback (giả lập lỗi ở bước renormalize) | Item được khôi phục, order các item khác không đổi |
| DELETE đồng thời với PUT trên cùng meeting | Không lost-update, tuần tự theo lock |

### AC mapping

Xem mục 15.6 (`Acceptance Criteria Traceability`) trong `spec.md`.

## 11. Implementation Phases

### Phase 1: Response DTO
- `DeleteAgendaItemResponseDto` tại `src/modules/meetings/dto/agenda-response.dto.ts` (hoặc file riêng `delete-agenda-item-response.dto.ts`)
  - Fields: `deleted: boolean`, `agendaId: string`, `meetingId: string`, `totalPlannedDurationMinutes: number`, `remainingDurationMinutes: number`, `remainingItemCount: number`

### Phase 2: Service Layer
- Method `deleteAgendaItem()` trong `MeetingsService`
- Helper `renormalizeAfterDelete(em, meetingId, deletedOrder)` — shift-left cho các item phía sau

### Phase 3: Controller & Routing
- `DELETE /meetings/:meetingId/agendas/:agendaId`
- `JwtAuthGuard`

### Phase 4: Unit Tests
- Service tests (12+ cases, xem mục 10)
- Controller response format tests

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Race condition giữa DELETE và PUT/PATCH trên cùng meeting | Lost update / order bị lệch | Dùng chung `pessimistic_write` lock trên `meetings` row |
| Double-click DELETE gây lỗi 500 thay vì 404 | UX xấu, khó debug | Đảm bảo bước load item nằm trong transaction, sau khi đã có lock — item không tồn tại → throw `NotFoundException` rõ ràng, không để lỗi DB constraint rơi xuống tầng dưới |
| Renormalize sai khi xóa nhiều item liên tiếp nhanh (spam click nhiều nút xóa khác nhau) | Data corruption (trùng order) | Mỗi DELETE là 1 transaction độc lập có lock — request sau luôn thấy state đã renormalize của request trước |
| Quên đồng bộ error code `AGENDA_ITEM_NOT_FOUND` giữa PATCH (UC-MM-10) và DELETE (UC-MM-11) | Inconsistent error contract | Dùng chung constant/error code string giữa 2 feature |

## 13. Acceptance Criteria Traceability

Xem mục 15.6 trong `spec.md` — 14 AC map trực tiếp tới FR/BR tương ứng.
