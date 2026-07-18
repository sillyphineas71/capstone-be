# Research: Chỉnh sửa agenda item (UC-MM-10)

- **Feature ID**: UC-MM-10
- **Created**: 2026-07-17
- **Status**: Complete

---

## Codebase Analysis

### UC-MM-09 (`feat-create-meeting-agenda`) đã build sẵn

| Thành phần | File | Có thể tái sử dụng cho UC-MM-10? |
|---|---|---|
| `MeetingAgendaEntity`, `AgendaStatus` enum | `src/modules/meetings/entities/meeting-agenda.entity.ts` | Có, dùng nguyên |
| `checkAgendaWritePermission(meeting, userId)` | `src/modules/meetings/services/meetings.service.ts` | Có, dùng nguyên |
| `validateMeetingTimeForAgenda(meeting)` | cùng file | Có, dùng nguyên |
| `validateMeetingStatusForAgendaWrite(meeting)` | cùng file | Có, dùng nguyên |
| `getMeetingDurationMinutes(meeting)` | cùng file | Có, dùng nguyên |
| `getParticipantUserIds(meetingId)` | cùng file | Có, dùng nguyên |
| `AgendaItemResponseDto` | `src/modules/meetings/dto/agenda-response.dto.ts` | Mở rộng thêm field cho response PATCH |
| Pessimistic lock pattern (`em.findOne(MeetingEntity, { lock: { mode: 'pessimistic_write' } })`) | `replaceAgendas()` | Dùng lại y hệt cho PATCH — đây là điểm mấu chốt để 2 luồng ghi (PUT, PATCH) không xung đột |
| Audit log write pattern (`em.create(AuditLogEntity, {...})`) | `replaceAgendas()` dòng ~4574 | Dùng lại field convention, đổi `actionType` |

### Route hiện có trong `meetings.controller.ts`

```
GET  /meetings/:meetingId/agendas          (dòng 921)
PUT  /meetings/:meetingId/agendas          (dòng 956)
```

Không có route `PATCH /meetings/:meetingId/agendas/:agendaId` nào tồn tại — xác nhận qua `grep -n "agenda" meetings.controller.ts`. Route mới sẽ được thêm ngay sau khối `replaceAgendas()` (~dòng 1024).

### API Contract gốc (`docs/API_CONTRACT_v1.0_with_system_roles.md`)

UC-28 (dòng 1288-1312) đặc tả PATCH với 4 permission tách rời (`meeting.agenda.create/read/update/delete`) và cho phép sửa cả `status`. Cả hai điểm này **lệch** với thiết kế đã build ở UC-MM-09 (permission gộp `meeting.agenda.write`/`read`, `status` là out-of-scope pre-meeting). Quyết định: giữ nhất quán với UC-MM-09 đã code, không theo đúng 100% API Contract gốc — ghi rõ trong `spec.md` mục 18 (Clarifications).

### FE (`FE_SmarTracking`)

Không tìm thấy file nào liên quan đến `agenda` trong FE (`find . -iname "*agenda*"` không có kết quả). FE chưa cam kết theo bất kỳ contract nào — an toàn để chọn thiết kế nhất quán với backend thay vì bám API Contract cũ.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Permission model | Tái sử dụng `meeting.agenda.write` | Tránh 2 mô hình RBAC song song cho cùng bảng `meeting_agendas` |
| Lock strategy | `pessimistic_write` trên `meetings` row, dùng chung với PUT | Đơn giản hơn optimistic locking/version field, đủ cho MVP, nhất quán với UC-MM-09 |
| DTO | Tạo `UpdateAgendaItemDto` mới (toàn bộ optional) | `AgendaItemDto` hiện có yêu cầu `title`/`plannedDurationMinutes` bắt buộc, không phù hợp cho PATCH |
| Not-found semantics | 404 `AGENDA_ITEM_NOT_FOUND` (khác với 422 `AGENDA_ITEM_NOT_IN_MEETING` của PUT) | PATCH truy cập resource qua path param (`agendaId`), đúng ngữ nghĩa REST là 404; PUT validate phần tử trong mảng bulk nên dùng 422 |
| Order shift | Tính shift plan trong service, không dùng SQL trigger | Giữ business logic minh bạch trong TypeScript, dễ test, đồng nhất style code hiện có |
| Audit action | `agenda_item_updated` (khác `agenda_saved` của PUT) | Phân biệt rõ nguồn gốc thay đổi khi tra audit log |

## Risks Identified

1. `@IsUUID('4')` mặc định không cho phép `null` — cần `@ValidateIf` hoặc `@IsOptional()` kết hợp kiểm tra thủ công để cho phép `ownerId: null` (un-assign owner).
2. Nếu không cẩn thận, việc renormalize `agenda_order` khi PATCH có thể conflict với renormalize của PUT nếu 2 request chạy gần như đồng thời — đã mitigate bằng lock chung ở mức `meetings` row.
3. `forbidNonWhitelisted: true` sẽ tự động reject field `status`/`actualDurationMinutes`/`resultNote` nếu DTO không khai báo — cần đảm bảo `UpdateAgendaItemDto` **không** khai báo các field này, không chỉ đơn giản là `@IsOptional()`.
4. Cần đảm bảo response DTO PATCH thêm 2 field `totalPlannedDurationMinutes`/`remainingDurationMinutes` tính bằng cách gọi lại toàn bộ danh sách item sau update (không thể tính chỉ từ 1 item).

## Dependencies

- Không có dependency mới ngoài module `meetings` hiện có.
- Không cần seed permission mới (dùng `meeting.agenda.write` đã tồn tại theo UC-MM-09).
