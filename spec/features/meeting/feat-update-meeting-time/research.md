# Research: UC-MM-02 — Cập nhật thời gian họp

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Initial research after spec completion | All |

---

## 1. Codebase Analysis

### 1.1 Meetings Module (`src/modules/meetings/`)

| Artifact | Trạng thái | Ghi chú |
|---|---|---|
| `meetings.service.ts` | ✅ Có sẵn | 626 dòng, dùng `DataSource` trực tiếp, có `getRoomAvailability()`, `checkParticipantConflicts()`, `getAvailableRooms()` |
| `meetings.controller.ts` | ✅ Có sẵn | 3 endpoints: POST create, GET rooms/available, POST approve/reject |
| `meeting.entity.ts` | ✅ Có sẵn | 27 columns, `MeetingStatus` enum (`scheduled`/`in_progress`/`completed`/`cancelled`) |
| `meeting-participant.entity.ts` | ✅ Có sẵn | FK users + meetings |
| `meeting-request.entity.ts` | ✅ Có sẵn | `MeetingRequestType.UPDATE_TIME`, `ApprovalMode.AUTO`, `ApprovalStatus.APPLIED` đã tồn tại |
| `meeting-event.entity.ts` | ✅ Có sẵn | `MeetingEventType` chưa có `meeting_time_updated` → **cần thêm** |
| `meeting-request-review.service.ts` | ✅ Có sẵn | 582 dòng, approve/reject pattern, pessimistic lock, re-check conflict |

### 1.2 Room Module Entities

| Entity | Trạng thái |
|---|---|
| `room-booking.entity.ts` | ✅ `BookingType.RELOCATED` đã tồn tại |
| `room-booking-usage.entity.ts` | ✅ Đã có entity nhưng chưa có service sử dụng |

### 1.3 Notification Module

| Artifact | Trạng thái |
|---|---|
| `notification.entity.ts` | ✅ `NotificationType` chưa có `meeting_time_updated` → **cần thêm** |
| `NotificationsService` | ❌ Chưa tồn tại. Notification được tạo inline trong transaction |

### 1.4 Administration Module

| Entity | Trạng thái |
|---|---|
| `audit-log.entity.ts` | ✅ Có sẵn, pattern template đầy đủ |
| `background-job.entity.ts` | ✅ `BackgroundJobStatus.QUEUED`, `BackgroundJobType.SEND_EMAIL` đã tồn tại |

### 1.5 Common Patterns

| Pattern | Chi tiết |
|---|---|
| Auth | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions()` |
| User extraction | `request['user'] as { userId: string }` |
| Transaction | `dataSource.transaction(async (em) => { ... })` |
| Error throwing | `throw new ConflictException({ success: false, message, error: { code, details } })` |
| Audit log | Inline `em.create(AuditLogEntity, { ... })` inside transaction |
| Pessimistic lock | `em.findOne(entity, { where, lock: { mode: 'pessimistic_write' } })` |
| Room conflict check | Query `RoomBookingEntity` với `status IN (PENDING, APPROVED, ACTIVE)` và overlap: `start <= endTime AND end >= startTime` |
| Participant conflict | Query `MeetingParticipantEntity` JOIN `MeetingEntity` với overlap: `m.startTime < endTime AND m.endTime > startTime` |

---

## 2. Technology Decisions

### Decision 1: Không tạo service mới, mở rộng `MeetingsService` hiện tại
- **Rationale**: Spec yêu cầu update meeting time thuộc module `meetings`. `MeetingsService` đã có sẵn các method conflict checking cần thiết.
- **Alternatives considered**: Tạo `UpdateMeetingTimeService` riêng → Tạo thêm file không cần thiết vì logic không quá phức tạp.

### Decision 2: Dùng `DataSource.transaction()` hiện tại
- **Rationale**: Toàn bộ codebase dùng `DataSource` trực tiếp, không dùng repository classes. Giữ pattern cho consistency.
- **Alternatives considered**: Tạo custom repository → Không theo convention hiện tại.

### Decision 3: Thêm enum values thay vì tạo enum mới
- **Cần thêm**: `MeetingEventType.MEETING_TIME_UPDATED`, `NotificationType.MEETING_TIME_UPDATED`
- **Rationale**: Các enum values này mapping trực tiếp với spec requirements, không phá vỡ enum hiện có.
- **Risk**: Thấp — chỉ thêm giá trị mới, không sửa/xóa giá trị cũ.

### Decision 4: Tạo `UpdateMeetingTimeDto` mới
- **Rationale**: Spec yêu cầu DTO riêng với validation rules khác create meeting DTO.
- **Location**: `src/modules/meetings/dto/update-meeting-time.dto.ts`

### Decision 5: Pessimistic lock cho race condition prevention
- **Rationale**: `MeetingRequestReviewService` đã dùng pessimistic lock pattern cho meeting_requests. Room booking cũng cần pattern tương tự.
- **Implementation**: `em.findOne(RoomBookingEntity, { where, lock: { mode: 'pessimistic_write' } })` trước khi cập nhật.

### Decision 6: Notification tạo inline trong transaction
- **Rationale**: Codebase hiện tại chưa có `NotificationsService`. Giữ pattern cũ để consistency. Có thể tách sau nếu team yêu cầu.

---

## 3. Identified Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Race condition khi re-check room conflict | High | Pessimistic lock + re-check ngay trước commit |
| Notification creation thất bại sau transaction | Medium | Không rollback; ghi log + audit `notificationStatus: 'failed'` |
| MeetingRequestType enum value `update_time` chưa được dùng | Low | Enum value đã tồn tại, chỉ cần sử dụng |
| MeetingEventType và NotificationType thiếu value mới | Low | Chỉ cần add value, không ảnh hưởng code hiện có |
| `@CurrentUser()` decorator không được dùng trong module | Low | Controller sẽ dùng `request['user']` như pattern hiện tại |

---

## 4. Out of Scope Confirmation

- ❌ Không tạo API endpoint mới ngoài `PATCH /api/v1/meetings/{meetingId}/time`
- ❌ Không tạo bảng database mới
- ❌ Không implement email provider thật (chỉ tạo background job)
- ❌ Không implement recurring series update (only single instance)
- ❌ Không implement approval flow (tự động, dùng `approval_mode = 'auto'`)
