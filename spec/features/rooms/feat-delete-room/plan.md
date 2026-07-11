# Implementation Plan: Xóa phòng họp (UC-ROOM-03)

**Branch**: `030-delete-room` | **Date**: 2026-07-09
**Spec**: spec/features/rooms/feat-delete-room/spec.md

## Summary

Bổ sung 2 endpoint mới trong module `rooms`: `GET /api/v1/rooms/:roomId/deletion-impact` (preview, read-only) và `DELETE /api/v1/rooms/:roomId` (thực thi). Soft-delete phòng trong 1 transaction đồng bộ (release booking tương lai, null hóa `roomId` của meeting tương lai, ghi event/audit) — KHÔNG hủy meeting (BR2), KHÔNG đụng dữ liệu quá khứ (BR1). Ngay sau transaction commit (không chờ job), broadcast WebSocket `room.deleted` để lưới lịch phòng của mọi client cập nhật tức thời (POST-1, bổ sung sau đánh giá chéo — §0.9). Sau đó enqueue 1 `background_jobs` mới để bất đồng bộ gọi `scheduling/room-suggestions` cho từng meeting bị ảnh hưởng và gửi email/notification (POST-3). Tái dùng ~80% pattern con từ `MeetingsService.updateMeetingRoom()`/`getAvailableRoomsForMeeting()` (UC-MM-03) và `scheduling/room-suggestions` (đã có sẵn). Không thêm bảng/cột — chỉ 1 permission mới + vài giá trị enum-as-string mới (không cần migration).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT, BullMQ (qua `background_jobs` pattern có sẵn)
**Storage**: PostgreSQL (transaction đa bảng: `rooms`, `room_bookings`, `meetings`, `meeting_events`, `room_events`, `audit_logs`)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith, cross-module orchestration trong `rooms` module)
**Performance Goals**: Preview < 1s; transaction xóa < 3s kể cả ~100 meeting bị ảnh hưởng; notification xử lý bất đồng bộ, không giới hạn cứng
**Constraints**: Atomic transaction cho phần đồng bộ (FR-010); EX1 phải tính lại tại thời điểm `DELETE`, không tin cache/preview cũ; KHÔNG hard-delete; KHÔNG hủy meeting

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột; chỉ thêm giá trị enum-as-string (`varchar` columns, xác nhận không cần migration theo tiền lệ `BackgroundJobType`) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('room.delete')` (permission mới, seed SYSTEM_ADMIN + BUSINESS_ADMIN) cho cả 2 endpoint |
| **Scope Gate** | PASS | Chỉ 2 endpoint của UC-ROOM-03; KHÔNG sửa `updateMeetingRoom`/`getAvailableRoomsForMeeting` gốc (chỉ gọi/tham khảo); KHÔNG sửa `scheduling/room-suggestions` gốc; audit read-path khác (§0.7/CL-1) ghi nhận nhưng KHÔNG code trong feature này |
| **Module Gate** | PASS | Orchestration chính trong `src/modules/rooms/`; gọi `MeetingsService`/`SchedulingService`/`NotificationsService`/`BackgroundJobsService` qua injection giữa các module đã export sẵn, không import chéo bừa bãi |
| **API Gate** | PASS | Response `{success,message,data,meta}`; 2 endpoint mới hoàn toàn (chưa có trong API_CONTRACT gốc) — cần task đồng bộ tài liệu |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho EX1 (2 tín hiệu), atomicity, background job xử lý từng phần, gợi ý phòng đúng khung giờ từng meeting |

## Project Structure

### Documentation (this feature)

```text
spec/features/rooms/feat-delete-room/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/rooms/
├── rooms.module.ts                          # Update: import MeetingsModule/SchedulingModule/NotificationsModule/AdministrationModule (background jobs) nếu chưa có
├── controllers/
│   └── rooms.controller.ts                  # Update: thêm GET :roomId/deletion-impact + DELETE :roomId
├── services/
│   ├── rooms.service.ts                     # Update: thêm getDeletionImpact(), deleteRoom() (transaction phần đồng bộ)
│   └── room-delete-notification.processor.ts # NEW: worker xử lý background job (gợi ý phòng + gửi notification cho từng meeting)
├── dto/
│   ├── deletion-impact-response.dto.ts      # NEW
│   └── delete-room-response.dto.ts          # NEW
└── tests/
    ├── rooms.service.delete.spec.ts         # NEW
    └── room-delete-notification.processor.spec.ts  # NEW

src/modules/administration/entities/
└── background-job.entity.ts                 # Update: thêm giá trị BackgroundJobType.ROOM_DELETE_NOTIFY (enum TS, không migration)

src/modules/notifications/entities/
└── notification.entity.ts                   # Update: thêm giá trị NotificationType.MEETING_ROOM_REMOVED (enum TS, không migration)

src/database/seeds/
└── <timestamp>-SeedRoomDeletePermission.ts   # NEW: seed permission room.delete (SYSTEM_ADMIN, BUSINESS_ADMIN)
```

**Structure Decision**: Đặt orchestration chính (transaction đồng bộ FR-010) trong `RoomsService` vì đây là hành động khởi phát từ module `rooms`. Tách phần xử lý bất đồng bộ (gợi ý phòng + gửi email) ra 1 processor riêng (`room-delete-notification.processor.ts`) trong cùng module `rooms`, gọi sang `MeetingsService`/`SchedulingService`/`NotificationsService` qua injection — tránh nhét toàn bộ logic notification vào `RoomsService` (giữ single-responsibility, dễ test riêng).

## Complexity Tracking

Điểm phức tạp nhất: (1) đảm bảo transaction FR-010 atomic đúng nghĩa qua nhiều bảng (`rooms`, `room_bookings`, `meetings`, `meeting_events`, `room_events`); (2) đảm bảo EX1 được tính lại đúng tại thời điểm `DELETE` (không dùng lại kết quả preview); (3) xử lý lỗi từng phần trong background job (1 email gửi lỗi không được làm hỏng cả job). Cả 3 điểm đã có công thức rõ trong `data-model`/FR, không cần complexity exception.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/deletion-impact-response.dto.ts`, `dto/delete-room-response.dto.ts`, `services/room-delete-notification.processor.ts`, `tests/rooms.service.delete.spec.ts`, `tests/room-delete-notification.processor.spec.ts` trong `src/modules/rooms/`.
- Thêm giá trị enum mới: `BackgroundJobType.ROOM_DELETE_NOTIFY`, `NotificationType.MEETING_ROOM_REMOVED`.

### Phase 2: Foundational

#### T-A: DTO & Response shape

- `deletion-impact-response.dto.ts`: `roomId, roomName, affectedMeetingCount, blockedByInProgressMeeting`.
- `delete-room-response.dto.ts`: `roomId, deletedAt, affectedMeetingCount, notificationJobId`.

#### T-B: Controller shell

- `GET :roomId/deletion-impact`: `@UseGuards(PermissionsGuard)`, `@RequirePermissions('room.delete')`, `ParseUUIDPipe`.
- `DELETE :roomId`: cùng guard/permission, `ParseUUIDPipe`.

#### T-C: Service shell

- `RoomsService.getDeletionImpact(roomId)`, `RoomsService.deleteRoom(roomId, userId, ipAddress)` — throw `NotImplementedException` tạm.

### Phase 3: Business Logic — Truy vấn dùng chung

#### T-D: Query "cuộc họp tương lai bị ảnh hưởng" (dùng chung preview + xóa thật)

- `findFutureAffectedMeetings(roomId): Promise<MeetingEntity[]>` — điều kiện FR-022 (`room_id=:roomId AND start_time > now() AND status NOT IN (cancelled, completed)`).

#### T-E: Kiểm tra EX1

- `hasBlockingInProgressMeeting(roomId): Promise<boolean>` — điều kiện FR-023 (2 tín hiệu: `status=in_progress` HOẶC `status=scheduled AND now() BETWEEN start_time AND end_time`).

### Phase 4: Business Logic — Preview

#### T-F: `getDeletionImpact()`

- Check tồn tại phòng (404 nếu không) → gọi T-D (đếm) + T-E → trả `DeletionImpactResponseDto`.

### Phase 5: Business Logic — Xóa thật (transaction đồng bộ)

#### T-G: Check tồn tại + EX1 (tính lại)

- Check tồn tại phòng (404) → gọi T-E lại (KHÔNG tái dùng kết quả preview cũ) → nếu true, `ConflictException({code:'ROOM_IN_USE'})`.

#### T-H: Transaction chính

- Trong `dataSource.transaction()`:
  1. Soft-delete `rooms` (`em.softRemove` hoặc set `deletedAt` thủ công).
  2. Gọi T-D lấy danh sách meeting bị ảnh hưởng (trong transaction, dùng `em` để đảm bảo consistent read).
  3. Với mỗi meeting: tìm `room_bookings` liên quan có `status IN (pending,approved,active)` → set `RELEASED`.
  4. Set `meeting.roomId = null` cho từng meeting.
  5. Ghi `MeetingEventEntity` (`eventType='room_changed'` hoặc mới) cho từng meeting.
  6. Ghi 1 `RoomEventEntity` (`eventType='room_deleted'`) cho phòng.
  7. Trả về danh sách `meetingId` bị ảnh hưởng để dùng ở bước sau.

#### T-I: Audit log (ngoài transaction, fail không rollback)

- Mirror pattern `create()`/`update()`.

#### T-J: Enqueue background job

- Sau khi T-H + T-I hoàn tất: `backgroundJobsService.createQueuedJob({ jobType: BackgroundJobType.ROOM_DELETE_NOTIFY, relatedEntityType:'room', relatedEntityId: roomId, inputJson: { affectedMeetingIds } })` → lấy `jobId` để trả về FE (FR-011, FR-012).

#### T-J2: WebSocket broadcast (bổ sung sau đánh giá chéo, §0.9/FR-030)

- Ngay sau T-I (KHÔNG chờ T-K/background job): `websocketService.broadcast('room.deleted', { roomId, deletedAt: saved.deletedAt })`. Sự kiện MỚI, không tái dùng `room.updated` (tránh FE hiểu nhầm phòng chỉ đổi thông tin thay vì đã biến mất).

### Phase 6: Business Logic — Background Job Processor

#### T-K: Worker xử lý job `ROOM_DELETE_NOTIFY`

- `room-delete-notification.processor.ts`: nhận `inputJson.affectedMeetingIds`.
- Với mỗi `meetingId`: load meeting (attendeeCount, startTime, endTime, organizerId) → gọi `SchedulingService` (hoặc HTTP nội bộ tới `scheduling/room-suggestions`) lấy top 3 phòng thay thế → gọi `NotificationsService.enqueueNotification({type: MEETING_ROOM_REMOVED, channel: EMAIL, recipientUserIds: [organizerId], metadata: {suggestions}})`.
- Bọc try/catch PER-MEETING — lỗi 1 meeting không dừng vòng lặp (FR-027).
- Cập nhật `background_jobs.status/outputJson` khi xong toàn bộ (FR-026).

### Phase 7: Controller Wiring & Error Handling

#### T-L: Wire 2 handler

- `GET .../deletion-impact` → T-F.
- `DELETE :roomId` → T-G → T-H → T-I → T-J → response.
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 8: Testing

#### T-M: Unit test EX1 (2 tín hiệu)

- `status=in_progress` → block.
- `status=scheduled` + trong khung giờ, chưa `in_progress` → VẪN block (§0.3).
- `status=scheduled`, ngoài khung giờ (tương lai) → không block.

#### T-N: Unit test atomicity

- Giả lập lỗi ở bước con giữa transaction (vd ghi `RoomEventEntity` fail) → verify KHÔNG có thay đổi nào được lưu (rollback toàn bộ: `rooms.deletedAt` vẫn null, `meetings.roomId` không đổi).

#### T-O: Unit test preview vs xóa thật không lệch

- Verify `findFutureAffectedMeetings` (T-D) trả cùng kết quả khi gọi từ preview và từ transaction xóa thật (cùng điều kiện FR-022).

#### T-P: Unit test background job xử lý từng phần

- 3 meeting, 1 meeting gửi notification lỗi (mock throw) → verify 2 meeting còn lại vẫn được xử lý, job vẫn `completed` với `outputJson` ghi rõ 1 thất bại (FR-027).

#### T-Q: Unit test gợi ý phòng đúng theo từng meeting

- 2 meeting khác khung giờ/sức chứa → verify gọi `scheduling/room-suggestions` với đúng tham số riêng của từng meeting (FR-DATA-002), không dùng chung 1 bộ tham số.

#### T-R: Unit test không đụng dữ liệu quá khứ

- Meeting `status=completed` hoặc `startTime` quá khứ tại phòng bị xóa → KHÔNG nằm trong `affectedMeetingCount`, `roomId` không đổi (BR1, FR-003).

#### T-S: Unit test seed permission

- Seed tạo đúng `room.delete`, gán đúng `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-D, T-E, T-F | Unit: preview đúng số + cờ |
| AC-002 | T-G, T-H, T-I, T-J | Unit: xóa thành công, roomId=null, status không đổi |
| AC-003 | T-K, T-Q | Unit: notification đúng gợi ý theo từng meeting |
| AC-004 | T-E, T-G | Unit: block khi in_progress |
| AC-005 | T-E, T-G | Unit: block khi trong khung giờ dù chưa in_progress |
| AC-006 | T-D, T-R | Unit: không có meeting tương lai → xóa thẳng, không job |
| AC-007 | T-B (guard) | Unit: thiếu permission |
| AC-008 | T-J2 | Unit: `room.deleted` broadcast đúng 1 lần, không chờ background job |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Race condition giữa preview và xóa thật (meeting mới được đặt vào phòng ngay trước khi bấm "Đồng ý xóa") | Số liệu preview không khớp thực tế lúc xóa | T-G tính lại EX1 + T-D tính lại danh sách meeting NGAY trong transaction xóa thật, không tái sử dụng kết quả preview (đã ghi rõ FR-009, FR-DATA-001) |
| Transaction xử lý nhiều meeting cùng lúc chậm nếu phòng có rất nhiều booking tương lai | Vượt NFR-002 | Giữ transaction chỉ làm DB write đơn giản (không gọi network/email trong transaction) — mọi việc nặng (gợi ý phòng, gửi email) đẩy sang background job (§0.5) |
| 1 email gửi lỗi làm hỏng toàn bộ tiến trình thông báo | Nhiều organizer không nhận được thông báo dù meeting của họ đã mất phòng | T-K bọc try/catch per-meeting (FR-027), test T-P xác nhận |
| Rủi ro §0.7 (soft-delete phá hiển thị lịch sử ở feature khác) không được xử lý kịp trước khi feature này lên production | Vi phạm BR1 âm thầm ở feature khác | Ghi rõ CL-1, khuyến nghị task audit riêng trước release — không tự ý sửa code feature khác trong phạm vi này |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001–FR-003 | T-H | Soft-delete, không hủy meeting, không đụng quá khứ |
| FR-004–FR-006 | T-F | Preview |
| FR-007–FR-009 | T-G | Check tồn tại + EX1 tại thời điểm xóa |
| FR-010 | T-H | Transaction chính |
| FR-011, FR-012 | T-J, T-L | Enqueue job + response |
| FR-013, FR-DATA-002 | T-K | Gợi ý phòng + gửi notification |
| FR-014 | T-D, T-J (điều kiện không enqueue) | Không có meeting nào bị ảnh hưởng |
| FR-015 | T-K | 0 kết quả gợi ý vẫn gửi được |
| FR-016–FR-020 | T-B, T-G | Validation/auth/not-found |
| FR-021 | T-B | Permission |
| FR-022–FR-025 | T-D, T-E, T-H, T-I | Data & State |
| FR-026, FR-027 | T-K | Background job status/outputJson |
| FR-028, FR-029 | T-H, T-G | Atomicity, ưu tiên EX1 |
| FR-030 | T-J2 | WebSocket broadcast `room.deleted` |
