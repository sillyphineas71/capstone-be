# Tasks: Xóa phòng họp (UC-ROOM-03)

**Feature**: ROOM-DELETE-ROOM-001 — Delete Meeting Room
**Module**: rooms (orchestrator: meetings, notifications, administration, scheduling)
**Branch**: `030-delete-room`
**Date**: 2026-07-09

**Input documents**:
- spec.md, plan.md

**Path Conventions**:
- Source files: `src/modules/rooms/` (chính) + sửa nhỏ 2 file enum ở `notifications`/`administration`
- Seed file: `src/database/seeds/`
- Tái dùng qua injection: `MeetingsService` (đọc meeting, KHÔNG gọi `updateMeetingRoom` trực tiếp), `SchedulingService`/`scheduling/room-suggestions`, `NotificationsService.enqueueNotification()`, `BackgroundJobsService.createQueuedJob()`

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/rooms/dto/deletion-impact-response.dto.ts`
- [ ] T002 [P] Tạo `src/modules/rooms/dto/delete-room-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/rooms/services/room-delete-notification.processor.ts`
- [ ] T004 [P] Tạo `src/modules/rooms/tests/rooms.service.delete.spec.ts`
- [ ] T005 [P] Tạo `src/modules/rooms/tests/room-delete-notification.processor.spec.ts`
- [ ] T006 [P] Thêm `BackgroundJobType.ROOM_DELETE_NOTIFY = 'room_delete_notify'` vào `src/modules/administration/entities/background-job.entity.ts` (chỉ thêm giá trị enum TS, cột DB đã `varchar`, không migration)
- [ ] T007 [P] Thêm `NotificationType.MEETING_ROOM_REMOVED = 'meeting_room_removed'` vào `src/modules/notifications/entities/notification.entity.ts` (tương tự, không migration)

---

## Phase 2: Foundational

- [ ] T008 [FR-006] [P] Implement `DeletionImpactResponseDto` trong `deletion-impact-response.dto.ts`
  - `roomId: string, roomName: string, affectedMeetingCount: number, blockedByInProgressMeeting: boolean`

- [ ] T009 [FR-012] [P] Implement `DeleteRoomResponseDto` trong `delete-room-response.dto.ts`
  - `roomId: string, deletedAt: Date, affectedMeetingCount: number, notificationJobId: string`

- [ ] T010 [FR-004, FR-007] Thêm 2 handler (shell) vào `rooms.controller.ts`
  - `@Get(':roomId/deletion-impact')` — khai TRƯỚC route khác nếu có xung đột path param (theo đúng comment pattern đã dùng ở `realtime-status` vs `:roomId/status`)
  - `@Delete(':roomId')`
  - Cả 2: `@UseGuards(PermissionsGuard)`, `@RequirePermissions('room.delete')`, `ParseUUIDPipe` cho `roomId`

- [ ] T011 [FR-001] Thêm method shell `getDeletionImpact()`, `deleteRoom()` vào `rooms.service.ts`
  - Inject thêm: `SchedulingService` (hoặc HTTP client nội bộ), `NotificationsService`, `BackgroundJobsService` — kiểm tra provider nào cần export thêm từ module tương ứng
  - Throw `NotImplementedException` tạm

- [ ] T012 [Module] Cập nhật `rooms.module.ts`
  - Import `MeetingsModule`/`SchedulingModule`/`NotificationsModule`/`AdministrationModule` (hoặc chỉ service cụ thể nếu module đã export sẵn theo pattern hiện có) để inject vào `RoomsService`/`RoomDeleteNotificationProcessor`

---

## Phase 3: Business Logic — Truy vấn dùng chung

- [ ] T013 [FR-022, FR-DATA-001] Implement `findFutureAffectedMeetings(roomId, em?)` trong `rooms.service.ts`
  - `WHERE room_id = :roomId AND start_time > now() AND status NOT IN ('cancelled','completed')`
  - Tham số `em` optional (EntityManager) — cho phép gọi trong transaction (T-H) hoặc ngoài (preview T-F)

- [ ] T014 [FR-023] Implement `hasBlockingInProgressMeeting(roomId)` trong `rooms.service.ts`
  - `EXISTS (... WHERE room_id=:roomId AND (status='in_progress' OR (status='scheduled' AND now() BETWEEN start_time AND end_time)))`

---

## Phase 4: Business Logic — Preview

- [ ] T015 [FR-004, FR-005, FR-006] Implement `getDeletionImpact(roomId)`
  - Check tồn tại phòng (`deletedAt IS NULL`) → `NotFoundException({code:'ROOM_NOT_FOUND'})` nếu không có
  - Gọi T013 (đếm `.length`) + T014 → trả `DeletionImpactResponseDto`

---

## Phase 5: Business Logic — Xóa thật (transaction đồng bộ)

- [ ] T016 [FR-008, FR-009, ERR-004, ERR-005] Implement check đầu `deleteRoom()`
  - Check tồn tại phòng → `ROOM_NOT_FOUND` nếu không
  - Gọi lại T014 (KHÔNG dùng kết quả preview cũ) → nếu `true`, `ConflictException({code:'ROOM_IN_USE'})`

- [ ] T017 [FR-010a] Implement soft-delete `rooms` trong transaction
  - `em.softRemove(RoomEntity, room)` hoặc set `deletedAt = now()` thủ công + `em.save()`

- [ ] T018 [FR-010b, FR-024] Implement release `room_bookings` liên quan trong transaction
  - Với mỗi meeting từ T013 (gọi trong transaction, dùng `em`): tìm `room_bookings WHERE meeting_id=:id AND room_id=:roomId AND status IN ('pending','approved','active')` → set `status='released'`

- [ ] T019 [FR-010c, FR-002] Implement null hóa `roomId` cho từng meeting trong transaction
  - `meeting.roomId = null` → `em.save(MeetingEntity, meeting)` — KHÔNG đổi `meeting.status`

- [ ] T020 [FR-010d] Implement ghi `MeetingEventEntity` cho từng meeting trong transaction
  - `eventType` tái dùng `ROOM_CHANGED` hoặc thêm giá trị mới `ROOM_UNASSIGNED` (quyết định khi code: ưu tiên tái dùng `ROOM_CHANGED` nếu field đủ diễn đạt qua `metadataJson: {reason: 'room_deleted', oldRoomId, newRoomId: null}`)

- [ ] T021 [FR-010e] Implement ghi 1 `RoomEventEntity` cho phòng trong transaction
  - `eventType='room_deleted'`, `roomId`, `meetingId=null`, `sourceType='system'` (hoặc `'admin'` nếu field hỗ trợ)

- [ ] T022 [FR-010f, FR-025] Implement ghi `AuditLogEntity` (NGOÀI transaction chính, fail không rollback — mirror `create()`/`update()`)
  - `actionType='delete'`, `entityType='room'`, `entityId=roomId`, `newValueJson={deletedAt, affectedMeetingIds}`

- [ ] T022b [FR-030, §0.9] Implement WebSocket broadcast `room.deleted` (bổ sung sau đánh giá chéo với `feat-update-room-info`)
  - Ngay sau T022 (audit log), TRƯỚC khi enqueue background job (T023): `websocketService.broadcast('room.deleted', { roomId, deletedAt: saved.deletedAt })`
  - Event MỚI, không tái dùng `room.updated` — inject `WebsocketService` vào `RoomsService` nếu chưa có (đã dùng chung cho `feat-update-room-info`, kiểm tra provider đã sẵn trong module)

- [ ] T023 [FR-011, FR-014] Implement enqueue background job SAU khi transaction + audit hoàn tất
  - Nếu `affectedMeetingIds.length === 0` → KHÔNG enqueue (FR-014), `notificationJobId = null`
  - Ngược lại: `backgroundJobsService.createQueuedJob({jobType: BackgroundJobType.ROOM_DELETE_NOTIFY, relatedEntityType:'room', relatedEntityId: roomId, requestedBy: userId, inputJson: {affectedMeetingIds}})`

- [ ] T024 [FR-012] Implement build response cuối `deleteRoom()`
  - Trả `DeleteRoomResponseDto` với `affectedMeetingCount`, `notificationJobId`

---

## Phase 6: Business Logic — Background Job Processor

- [ ] T025 [FR-013, FR-DATA-002] Implement `RoomDeleteNotificationProcessor` xử lý job `ROOM_DELETE_NOTIFY`
  - Đọc `inputJson.affectedMeetingIds`
  - Với mỗi `meetingId`: load `MeetingEntity` (attendeeCount qua `getAttendeeCount` nếu có sẵn ở `MeetingsService`, startTime, endTime, organizerId)
  - Gọi `scheduling/room-suggestions` (hoặc service tương ứng) với đúng `attendeeCount`/`startTime`/`endTime` của MEETING ĐÓ → lấy `top 3` (CL-3, mặc định 3)

- [ ] T026 [FR-013] Implement enqueue notification cho từng meeting
  - `notificationsService.enqueueNotification({notificationType: NotificationType.MEETING_ROOM_REMOVED, channel: NotificationChannel.EMAIL, recipientUserIds: [meeting.organizerId], metadataJson: {meetingId, meetingTitle, suggestedRooms}})`

- [ ] T027 [FR-015] Implement fallback khi 0 phòng gợi ý
  - Vẫn gọi T026 nhưng `suggestedRooms: []` — không chặn, không lỗi

- [ ] T028 [FR-027] Implement try/catch per-meeting trong vòng lặp T025-T026
  - Lỗi 1 meeting → log + đưa vào `failedMeetingIds`, KHÔNG throw ra ngoài vòng lặp, tiếp tục xử lý meeting kế tiếp

- [ ] T029 [FR-026] Implement cập nhật `background_jobs` sau khi xử lý xong toàn bộ
  - `status='completed'`, `outputJson={successCount, failedMeetingIds}`

---

## Phase 7: Controller Wiring & Error Handling

- [ ] T030 [FR-004] Hoàn thiện handler `GET :roomId/deletion-impact`
  - Gọi `getDeletionImpact()` → trả `{success:true, message:'Thông tin tác động đã được truy xuất', data}`

- [ ] T031 [FR-012] Hoàn thiện handler `DELETE :roomId`
  - Gọi `deleteRoom()` → trả `{success:true, message:'Xóa phòng họp thành công', data}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 8: Testing

- [ ] T032 [Test, AC-004, AC-005] [P] Unit test `hasBlockingInProgressMeeting()` — 2 tín hiệu
  - `status=in_progress` → `true`
  - `status=scheduled`, `now` trong `[start,end]`, chưa `in_progress` → `true`
  - `status=scheduled`, tương lai ngoài khung giờ → `false`

- [ ] T033 [Test, AC-006] [P] Unit test `findFutureAffectedMeetings()`
  - Loại đúng meeting quá khứ / `completed` / `cancelled`
  - Giữ đúng meeting `draft`/`pending_approval`/`scheduled` có `startTime > now()`

- [ ] T034 [Test] [P] Unit test atomicity (T-N trong plan.md)
  - Mock lỗi ở 1 bước con (vd `RoomEventEntity` save fail) → verify KHÔNG có thay đổi nào persist (rollback toàn bộ)

- [ ] T035 [Test, AC-002] [P] Unit test `deleteRoom()` happy path
  - `roomId` bị soft-delete đúng, `meetings.roomId=null`, `meetings.status` KHÔNG đổi, `room_bookings` liên quan → `released`
  - `notificationJobId` được trả về đúng khi có meeting bị ảnh hưởng

- [ ] T036 [Test, AC-006] [P] Unit test không có meeting bị ảnh hưởng
  - `affectedMeetingCount=0` → KHÔNG gọi `createQueuedJob`, `notificationJobId=null`

- [ ] T037 [Test, AC-004] [P] Unit test check EX1 lại tại thời điểm `DELETE` (không tin preview)
  - Giả lập: preview trả `blockedByInProgressMeeting=false`, nhưng ngay trước khi `DELETE` chạy có 1 meeting chuyển `in_progress` → `deleteRoom()` vẫn phải block đúng (không cache)

- [ ] T038 [Test, AC-003] [P] Unit test `RoomDeleteNotificationProcessor` — gợi ý đúng theo từng meeting
  - 2 meeting khác `attendeeCount`/khung giờ → verify gọi `room-suggestions` với đúng tham số riêng biệt cho từng cái (không dùng chung 1 bộ)

- [ ] T039 [Test] [P] Unit test xử lý lỗi từng phần trong processor
  - 3 meeting, 1 cái gửi notification lỗi (mock throw) → 2 cái còn lại vẫn xử lý xong, `background_jobs.status='completed'`, `outputJson.failedMeetingIds` chứa đúng 1 phần tử

- [ ] T040 [Test] [P] Unit test fallback 0 gợi ý (FR-015)
  - `room-suggestions` trả `[]` → vẫn gọi `enqueueNotification` với `suggestedRooms: []`, không lỗi

- [ ] T041 [Test] [P] Unit test seed permission `room.delete`
  - Seed tạo đúng permission, gán đúng `SYSTEM_ADMIN` + `BUSINESS_ADMIN`

- [ ] T042 [Test] [P] Unit test controller (2 endpoint)
  - Request hợp lệ → 200 đúng cấu trúc `{success, message, data}`
  - Thiếu permission → 403; `roomId` không tồn tại → 404; phòng đang dùng → 409

- [ ] T042b [Test, AC-008] [P] Unit test WebSocket broadcast `room.deleted`
  - Xóa thành công → `websocketService.broadcast` gọi đúng 1 lần với event `room.deleted` và đúng payload `{roomId, deletedAt}`
  - Broadcast xảy ra TRƯỚC/không phụ thuộc kết quả background job (mock job enqueue fail → broadcast vẫn đã xảy ra trước đó, không bị ảnh hưởng)
  - Xóa thất bại (404/409) → `broadcast` KHÔNG được gọi

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T043 [Polish] Verify response format `{success, message, data, meta}` cho cả 2 endpoint
- [ ] T044 [Polish, FR-001, FR-002, FR-003] Verify KHÔNG có bất kỳ thao tác hard-delete/cancel-meeting/chỉnh-sửa-quá-khứ nào lọt vào code
- [ ] T045 [Polish] Verify mọi raw SQL/query builder dùng parameter binding
- [ ] T046 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `ROOM_NOT_FOUND`, `ROOM_IN_USE`, `PERMISSION_DENIED`, `INTERNAL_ERROR`
- [ ] T047 [Polish, FR-028] Verify transaction FR-010 KHÔNG chứa bất kỳ lệnh gọi network/email nào (toàn bộ phần đó đã tách sang background job) — đảm bảo NFR-002
- [ ] T048 [Docs] Ghi chú vào tài liệu API contract nội bộ rằng `GET .../deletion-impact` và `DELETE /api/v1/rooms/:roomId` là 2 endpoint mới cho UC-ROOM-03
- [ ] T049 [Docs, CL-1] Tạo task/ghi chú riêng (ngoài phạm vi code feature này) để audit các read-path hiển thị tên phòng lịch sử (đặc biệt `feat-view-room-usage-history`) có dùng `withDeleted: true` hay chưa — theo dõi trước khi release feature này lên production

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Truy vấn dùng chung)**: Phụ thuộc Phase 2
- **Phase 4 (Preview)**: Phụ thuộc Phase 3
- **Phase 5 (Xóa thật)**: Phụ thuộc Phase 3; độc lập với Phase 4 (không phụ thuộc lẫn nhau ngoài dùng chung T013/T014)
- **Phase 6 (Background processor)**: Phụ thuộc Phase 5 (cần `affectedMeetingIds` do Phase 5 tạo ra)
- **Phase 7 (Wiring)**: Phụ thuộc Phase 4 + Phase 5
- **Phase 8 (Testing)**: Phụ thuộc Phase 7
- **Phase 9 (Polish)**: Phụ thuộc Phase 8

### Parallel Opportunities

- Phase 1: T001-T007 song song
- Phase 3: T013, T014 song song
- Phase 5: T017-T022 tuần tự trong cùng transaction (không song song được — cùng 1 `em`)
- Phase 8: T032-T042 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Preview hoạt động đầy đủ (ít rủi ro nhất, làm trước để có baseline test)
3. Phase 5 — Transaction xóa thật (phần quan trọng nhất — atomic, EX1 tính lại)
4. Phase 6 — Background job xử lý gợi ý + notification
5. Phase 7 — Controller hoàn chỉnh
6. Phase 8 — Unit test toàn bộ nhánh (đặc biệt T034 atomicity và T037 EX1-không-cache)
7. Phase 9 — Seed permission, polish, ghi nhận rủi ro §0.7 để theo dõi riêng

MVP = Phase 1 → Phase 7.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T017–T019 |
| FR-004–FR-006 | T010, T015 |
| FR-007–FR-009 | T010, T016 |
| FR-010 | T017–T021 |
| FR-011, FR-012 | T023, T024, T031 |
| FR-013, FR-DATA-002 | T025, T026 |
| FR-014 | T023, T036 |
| FR-015 | T027, T040 |
| FR-016–FR-020 | T010, T016 |
| FR-021 | T010 |
| FR-022–FR-025 | T013, T014, T018, T022 |
| FR-026, FR-027 | T028, T029 |
| FR-028, FR-029 | T017–T022 (transaction), T016 |
| FR-030 | T022b, T042b |
