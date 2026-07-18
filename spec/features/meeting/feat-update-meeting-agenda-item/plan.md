# Implementation Plan: Chỉnh sửa agenda item (UC-MM-10)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Tạo plan lần đầu cho UC-MM-10 | Toàn bộ file |

---

- **Feature ID**: UC-MM-10 (UC-28)
- **Plan Version**: 1.0
- **Based on Spec**: `spec.md` (v2026-07-17)
- **Target Module**: `meetings`
- **Depends on**: UC-MM-09 (`feat-create-meeting-agenda`) — reuse `MeetingAgendaEntity`, permission model, `checkAgendaWritePermission`, `getMeetingDurationMinutes`, `getParticipantUserIds`

---

## 1. Feature Summary

Bổ sung `PATCH /api/v1/meetings/{meetingId}/agendas/{agendaId}` để sửa **một** agenda item cụ thể (partial update), tồn tại song song với `PUT /agendas` (bulk atomic replace, UC-MM-09). Cả hai luồng ghi dùng chung `checkAgendaWritePermission()`, cùng lock `meetings` row (`pessimistic_write`) trong transaction để tránh race condition.

## 2. Technical Context

### 2.1 Tech Stack

- **Runtime**: Node.js + NestJS
- **ORM**: TypeORM (`DataSource.transaction`, `pessimistic_write` lock)
- **Database**: PostgreSQL, bảng `meeting_agendas` (không đổi schema)
- **Auth**: JWT (`JwtAuthGuard`) + permission check trong service layer (giống UC-MM-09, không dùng `PermissionsGuard` decorator riêng)
- **Validation**: `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`

### 2.2 Existing Codebase Analysis

| File | Vai trò | Tái sử dụng |
|---|---|---|
| `src/modules/meetings/entities/meeting-agenda.entity.ts` | `MeetingAgendaEntity`, `AgendaStatus` enum | Dùng nguyên, không đổi |
| `src/modules/meetings/services/meetings.service.ts` | `checkAgendaWritePermission()`, `getMeetingDurationMinutes()`, `getParticipantUserIds()`, `validateMeetingTimeForAgenda()`, `validateMeetingStatusForAgendaWrite()` | Tái sử dụng trực tiếp, không viết lại |
| `src/modules/meetings/controllers/meetings.controller.ts` | Chứa `getAgendas()`, `replaceAgendas()` (dòng ~917-1024) | Thêm handler `updateAgendaItem()` ngay sau `replaceAgendas()` |
| `src/modules/meetings/dto/agenda-item.dto.ts` | `AgendaItemDto` (dùng cho PUT) | Không tái sử dụng trực tiếp (PUT DTO yêu cầu `title`/`plannedDurationMinutes` bắt buộc) — tạo DTO mới `UpdateAgendaItemDto` với mọi field `@IsOptional()` |
| `AuditLogEntity` (`administration` module) | `userId`, `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`, `severity` | Field convention giống audit log của `replaceAgendas()` (dòng ~4574-4585) |

### 2.3 Điểm khác biệt kỹ thuật so với PUT (UC-MM-09)

- PUT lock toàn bộ danh sách item + so sánh mảng; PATCH chỉ thao tác 1 row + có thể renormalize order của các row khác.
- PUT dùng `AgendaItemDto` (title/plannedDurationMinutes bắt buộc); PATCH dùng DTO mới toàn bộ optional.
- PATCH thêm error code mới: `AGENDA_ITEM_NOT_FOUND` (404), `AGENDA_INVALID_ORDER` (422), `AGENDA_UPDATE_PAYLOAD_EMPTY` (400).

## 3. Scope Confirmation

### In scope

- `PATCH /meetings/{meetingId}/agendas/{agendaId}` — partial update 1 item.
- Renormalize `agenda_order` khi client đổi vị trí.
- Revalidate duration overflow, owner participant.
- Audit log riêng (`agenda_item_updated`).
- Dùng chung lock resource với PUT để tránh race.
- No-op detection.

### Out of scope

- Bulk PATCH nhiều item (dùng PUT).
- Cập nhật `status`/`actualDurationMinutes`/`resultNote`.
- Notification/email.
- Optimistic locking version field.
- Thay đổi hành vi của `PUT /agendas` hiện có (không breaking change).

## 4. Data Model Impact

```
meeting_agendas   → UPDATE (1 item chính + có thể update agenda_order của item khác cùng meeting)
meetings          → READ ONLY (status, organizer_id, host_id, start_time, end_time) + LOCK (pessimistic_write)
meeting_participants → READ ONLY (validate ownerId)
audit_logs        → INSERT (action_type = 'agenda_item_updated')
```

Không thêm bảng, không thêm cột.

## 5. API / Contract Plan

Xem `contracts/update-agenda-item-api.md`.

## 6. Authorization Plan

Tái sử dụng `checkAgendaWritePermission(meeting, userId)` đã có trong `MeetingsService` (dòng ~4427 khu vực `replaceAgendas`). Không tạo permission mới, không tạo guard mới.

## 7. Business Logic Plan

### Core flow

```
1. Validate meetingId, agendaId là UUID hợp lệ (ParseUUIDPipe trên controller)
2. Validate DTO: whitelist field, forbidNonWhitelisted, body không rỗng (custom check trong service vì class-validator không tự detect "tất cả field đều undefined")
3. BEGIN TRANSACTION
4. Load meeting với pessimistic_write lock → 404 nếu không tồn tại/deleted
5. checkAgendaWritePermission() → 403 nếu không có quyền
6. validateMeetingTimeForAgenda() → 409 nếu invalid
7. validateMeetingStatusForAgendaWrite() → 409 nếu không scheduled
8. Load agenda item theo id + meetingId → 404 AGENDA_ITEM_NOT_FOUND nếu không có
9. Merge field được cung cấp vào working copy
10. Validate working copy: title/description/duration (nếu field đó có trong request)
11. Nếu ownerId có trong request: validate thuộc participants
12. No-op check: so sánh working copy với item hiện tại (field-by-field, chỉ field có trong request) → nếu giống hệt, COMMIT không đổi gì, trả response hiện tại
13. Nếu agendaOrder có trong request và khác hiện tại: load toàn bộ item của meeting, tính shift plan, validate agendaOrder trong khoảng [1, N]
14. Tính lại tổng plannedDurationMinutes (item đang sửa dùng giá trị mới) → so với meeting duration → 422 nếu overflow
15. UPDATE agenda item (+ UPDATE các item bị shift nếu có)
16. INSERT audit_logs (action_type = 'agenda_item_updated', diff old/new)
17. COMMIT TRANSACTION
18. Trả 200 với item đã cập nhật + tổng hợp duration
```

### Edge cases

- Body rỗng → 400 trước khi vào transaction (fail fast).
- `agendaOrder` bằng giá trị hiện tại → coi field đó là "không đổi" trong no-op check.
- Update đồng thời bởi 2 user → transaction thứ 2 chờ lock, áp dụng trên state mới nhất sau khi transaction 1 COMMIT.

## 8. Validation Plan

### DTO (`UpdateAgendaItemDto`)

| Field | Rule |
|---|---|
| `title` | `@IsOptional() @IsString() @MaxLength(255)` |
| `description` | `@IsOptional() @IsString() @MaxLength(2000)` |
| `ownerId` | `@IsOptional() @IsUUID('4')` (cho phép `null` — cần custom transform hoặc `@ValidateIf`) |
| `plannedDurationMinutes` | `@IsOptional() @IsInt() @Min(1)` |
| `agendaOrder` | `@IsOptional() @IsInt() @Min(1)` |

### Business validation

Xem bảng mục 8.2 trong `spec.md`.

## 9. Error Handling Plan

- Transaction fail → rollback toàn bộ → lỗi tương ứng hoặc 500.
- Audit log ghi trong cùng transaction với UPDATE (không best-effort, khác với UC-MM-08) — vì đây là single-row update nhanh, không có async side-effect (notification/job) nên không cần tách audit ra khỏi transaction.

## 10. Testing Strategy

### Unit tests (Service)

| Test | Expected |
|---|---|
| PATCH chỉ title | 200, chỉ title đổi |
| PATCH chỉ agendaOrder (di chuyển lên) | 200, các item liên quan renormalize |
| PATCH chỉ agendaOrder (di chuyển xuống) | 200, các item liên quan renormalize |
| PATCH ownerId hợp lệ | 200, ownerName resolve đúng |
| PATCH ownerId = null | 200, un-assign owner |
| PATCH ownerId không thuộc participants | 422 AGENDA_OWNER_NOT_PARTICIPANT |
| PATCH title rỗng | 422 AGENDA_TITLE_REQUIRED |
| PATCH title > 255 | 422 AGENDA_TITLE_TOO_LONG |
| PATCH description > 2000 | 422 AGENDA_DESCRIPTION_TOO_LONG |
| PATCH plannedDurationMinutes <= 0 | 422 AGENDA_INVALID_DURATION |
| PATCH gây overflow tổng duration | 422 AGENDA_DURATION_OVERFLOW |
| PATCH agendaOrder ngoài khoảng | 422 AGENDA_INVALID_ORDER |
| PATCH body rỗng | 400 AGENDA_UPDATE_PAYLOAD_EMPTY |
| PATCH chứa field status | 400 AGENDA_INVALID_PAYLOAD |
| PATCH agendaId không tồn tại | 404 AGENDA_ITEM_NOT_FOUND |
| PATCH agendaId thuộc meeting khác | 404 AGENDA_ITEM_NOT_FOUND |
| PATCH meeting không scheduled | 409 AGENDA_MEETING_STATUS_BLOCKED |
| PATCH bởi participant thường | 403 AGENDA_WRITE_FORBIDDEN |
| PATCH payload no-op | 200, không đổi updated_at, không audit log mới |
| PATCH transaction rollback (giả lập lỗi) | Item giữ nguyên giá trị cũ |

### AC mapping

Xem mục 15.6 (`Acceptance Criteria Traceability`) trong `spec.md`.

## 11. Implementation Phases

### Phase 1: DTO & Validation
- `UpdateAgendaItemDto` tại `src/modules/meetings/dto/update-agenda-item.dto.ts`
- `AgendaItemUpdateResponseDto` (mở rộng `AgendaItemResponseDto` với `totalPlannedDurationMinutes`, `remainingDurationMinutes`, `updatedAt`)

### Phase 2: Service Layer
- Method `updateAgendaItem()` trong `MeetingsService`
- Helper `renormalizeAgendaOrderForMove()` (tính shift plan)
- Helper `isAgendaItemPayloadSame()` (no-op detect cho 1 item)

### Phase 3: Controller & Routing
- `PATCH /meetings/:meetingId/agendas/:agendaId`
- `JwtAuthGuard` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`

### Phase 4: Unit Tests
- Service tests (17+ cases, xem mục 10)
- DTO validation tests
- Controller response format tests

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Race condition giữa PATCH và PUT trên cùng meeting | Lost update | Dùng chung `pessimistic_write` lock trên `meetings` row |
| `ownerId: null` bị `class-validator` từ chối do `@IsUUID` không cho null mặc định | DTO validation sai | Dùng `@ValidateIf((o) => o.ownerId !== null)` hoặc tương đương |
| Renormalize order sai logic khi shift qua nhiều vị trí | Data corruption (trùng order) | Viết unit test riêng cho các trường hợp shift lên/xuống/đầu/cuối danh sách |
| Quên đồng bộ duration overflow check với PUT | Business rule lệch giữa 2 endpoint | Tái sử dụng `getMeetingDurationMinutes()` đã có, không viết logic tính duration mới |

## 13. Acceptance Criteria Traceability

Xem mục 15.6 trong `spec.md` — 15 AC map trực tiếp tới FR/BR tương ứng.
