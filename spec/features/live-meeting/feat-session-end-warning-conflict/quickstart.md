# Quickstart — Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo quickstart lần đầu cho UC-IMM-13 | Toàn bộ file |

---

## Lưu ý quan trọng

UC-IMM-13 là **internal BullMQ job processor** — không có HTTP endpoint riêng. Để test end-to-end, cần:

1. **UC-IMM-12 phải hoạt động** trước (enqueue job khi meeting start).
2. **BullMQ + Redis** phải running trong môi trường test.
3. Để test nhanh (unit test), dùng `MeetingWarningService` trực tiếp với mock DataSource — không cần BullMQ thật.
4. Để test trigger thủ công: gọi `MeetingWarningService.processWarningJob({ meetingId, warningScheduledAt, endTime })` trực tiếp qua integration test hoặc test script.

---

## Prerequisite Checklist

Trước khi bắt đầu test, đảm bảo:

- [ ] UC-IMM-12 đã hoàn chỉnh và migration `20260619000001-AddWarningScheduledEventTypes.ts` đã chạy.
- [ ] `NotificationType` enum đã có `MEETING_TIME_WARNING` và `MEETING_TIME_CONFLICT_WARNING` (task T001).
- [ ] Seed `20260619000002-SeedMeetingWarningConflictConfig.ts` đã chạy.
- [ ] `MeetingWarningService` và `MeetingWarningProcessor` đã được đăng ký vào `LiveMeetingModule`.
- [ ] Redis đang running (BullMQ cần Redis để queue hoạt động).

---

## Test Scenarios

### Scenario 1 — Branch A Happy Path: Standard Warning (không có conflict)

**Setup:**
1. Tạo meeting với `status = in_progress`, `end_time = now() + 10 phút`, `room_id = R1`, `host_id = userA`.
2. Đảm bảo không có `room_bookings` active nào cho R1 sau `end_time`.
3. Đảm bảo `system_configs.meeting_warning_conflict_buffer_minutes = '0'`.
4. Tạo BullMQ job thủ công hoặc trigger qua UC-IMM-12 + `startMeeting()`.

**Trigger:**
```typescript
// Unit test / integration test — gọi service trực tiếp:
await meetingWarningService.processWarningJob({
  meetingId: 'uuid-meeting',
  warningScheduledAt: new Date().toISOString(),
  endTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
});
```

**Expect:**
- DB: `notifications` có record mới với `notification_type = meeting_time_warning`, `priority = normal`.
- DB: `notifications.payload_json.extensionAllowed = true`.
- DB: `notifications.payload_json.warningLevel = standard`.
- DB: `notifications.payload_json.cta.type = request_extension`.
- DB: `notifications.payload_json.conflictWithNextBooking = false`.
- DB: `meeting_events` có record `event_type = warning_sent`, `source_type = scheduler`.
- DB: `background_jobs` record cập nhật `status = completed`.
- Log: `[processWarningJob] DONE — branch=A, warningLevel=standard, remainingMinutes=10`.
- WebSocket: `meeting.time.warning` event được emit (verify qua mock WebsocketService).

---

### Scenario 2 — Branch B Happy Path: Conflict Warning (có booking tiếp theo)

**Setup:**
1. Tạo meeting với `status = in_progress`, `end_time = T+10m`, `room_id = R1`.
2. Tạo `room_bookings` record: `room_id = R1`, `reserved_start_time = T+10m`, `status = approved`, `meeting_id = meetingB`.
3. `system_configs.meeting_warning_conflict_buffer_minutes = '0'`.

**Expect:**
- `notifications.notification_type = meeting_time_conflict_warning`.
- `notifications.priority = high`.
- `notifications.payload_json.extensionAllowed = false`.
- `notifications.payload_json.warningLevel = strict`.
- `notifications.payload_json.cta = null`.
- `notifications.payload_json.conflictWithNextBooking = true`.
- `notifications.payload_json.nextBooking.reservedStartTime = T+10m`.
- WebSocket: Host nhận event qua `user:{hostId}` room với `extensionAllowed = false`.

---

### Scenario 3 — Conflict Buffer: Branch B kích hoạt trong buffer window

**Setup:**
1. `end_time = T+10m`, `room_id = R1`.
2. `room_bookings`: `reserved_start_time = T+13m` (trong buffer), `status = approved`.
3. `system_configs.meeting_warning_conflict_buffer_minutes = '5'`.

**Expect:**
- `T+13m <= T+10m + 5min (= T+15m)` → Branch B kích hoạt.
- `notifications.notification_type = meeting_time_conflict_warning`.

**Ngược lại — Branch A khi ngoài buffer:**
4. Đổi `reserved_start_time = T+16m`, giữ buffer=5.
5. `T+16m > T+15m` → Branch A.
6. `notifications.notification_type = meeting_time_warning`.

---

### Scenario 4 — Guard: Meeting đã ended trước khi job fired

**Setup:**
1. Tạo meeting với `status = completed` (đã end trước đó).
2. Gọi `processWarningJob({ meetingId, ... })`.

**Expect:**
- Return `{ skipped: true, reason: 'meeting_not_in_progress' }`.
- DB: Không có `notifications` record mới.
- DB: Không có `meeting_events` record mới.
- Log: WARN `[processWarningJob] Meeting not in_progress — skip`.
- BullMQ job: ACK (không retry).

---

### Scenario 5 — Guard: Meeting không tồn tại

**Setup:**
1. Gọi `processWarningJob({ meetingId: 'uuid-không-tồn-tại', ... })`.

**Expect:**
- Return `{ skipped: true, reason: 'meeting_not_found' }`.
- DB: Không có write nào.
- Log: ERROR.
- BullMQ job: ACK (không retry).

---

### Scenario 6 — Meeting online không có phòng (`room_id = null`)

**Setup:**
1. Meeting `status = in_progress`, `room_id = null`.

**Expect:**
- Conflict detection bị skip (không query `room_bookings`).
- Branch A áp dụng: `notifications.notification_type = meeting_time_warning`, `extensionAllowed = true`.
- Không có lỗi DB query.

---

### Scenario 7 — Late Job: `remainingMinutes` âm → clamp = 0, warningLevel = overdue

**Setup:**
1. Meeting `end_time = 5 phút trước` (đã qua giờ), `status = in_progress` (chưa end thủ công).
2. Không có conflict booking.

**Expect:**
- `remainingMinutes` tính ra âm → clamp về 0.
- `notifications.payload_json.remainingMinutes = 0` (không âm).
- `notifications.payload_json.warningLevel = overdue` (Branch A + late).
- Log: WARN `[processWarningJob] Late job — meetingId={X}, delay=5min`.

**Nếu có conflict booking:**
- `warningLevel = urgent` (Branch B + late).

---

### Scenario 8 — Idempotency: Job retry / duplicate

**Setup:**
1. Chạy `processWarningJob()` lần 1 → thành công, `meeting_events.warning_sent` được tạo.
2. Gọi lại `processWarningJob()` lần 2 (simulate BullMQ retry hoặc duplicate job).

**Expect:**
- Lần 2: phát hiện `meeting_events.warning_sent` đã tồn tại.
- Return `{ skipped: true, reason: 'already_sent' }`.
- DB: Không có duplicate `notifications` record.
- DB: Không có duplicate `meeting_events`.
- Log: INFO `[processWarningJob] Idempotency guard — warning_sent already exists`.

---

### Scenario 9 — Degraded Mode: Conflict query DB lỗi → fallback Branch A

**Setup:**
1. Meeting `in_progress` có `room_id`.
2. Mock `dataSource.getRepository(RoomBookingEntity).findOne()` throw exception.

**Expect:**
- Log: ERROR về conflict query failure.
- Hệ thống fallback Branch A: `notifications.notification_type = meeting_time_warning`.
- `background_jobs.status = completed` (không failed).

---

### Scenario 10 — Notification tạo thất bại → NACK

**Setup:**
1. Meeting `in_progress`, conflict detection thành công.
2. Mock `dataSource.getRepository(NotificationEntity).save()` throw exception.

**Expect:**
- DB: `background_jobs.status = failed`.
- DB: Không có `meeting_events` record.
- Processor throw error → BullMQ retry theo job options (tối đa 3 lần).
- Log: ERROR.

---

### Scenario 11 — WebSocket thất bại → non-critical

**Setup:**
1. Notification đã INSERT thành công.
2. Mock `websocketService.emitToUser()` throw exception.

**Expect:**
- Log: WARN.
- `background_jobs.status = completed` (không failed).
- `meeting_events.warning_sent` được tạo bình thường.
- Notification record không bị rollback.

---

### Scenario 12 — Host không tìm được

**Setup:**
1. Meeting `host_id = null`.
2. Không có `meeting_participants` với `participant_role = 'host'`.

**Expect:**
- Return `{ skipped: true, reason: 'host_not_found' }`.
- DB: Không có `notifications` record.
- Log: WARN.

---

## WebSocket Payload Split Verification (Scenario 2 extension)

**Test tách payload:**
1. Chạy Scenario 2 (Branch B, conflict).
2. Verify `websocketService.emitToUser()` được gọi với `hostId` và payload có: `extensionAllowed`, `disableExtensionReason`, `warningLevel`, `nextBooking`.
3. Verify `websocketService.emitToRoom()` được gọi với `meeting:{meetingId}` và payload **không có**: `extensionAllowed`, `nextBooking`.

---

## Verification Checklist (Post-Implementation)

### Enum & Seed
- [ ] `NotificationType.MEETING_TIME_WARNING = 'meeting_time_warning'` tồn tại trong entity.
- [ ] `NotificationType.MEETING_TIME_CONFLICT_WARNING = 'meeting_time_conflict_warning'` tồn tại.
- [ ] Seed: `system_configs` có row `meeting_warning_conflict_buffer_minutes = '0'`.
- [ ] Không có TypeORM migration mới cho UC-IMM-13 (column là VARCHAR(60)).

### BullMQ Processor Registration
- [ ] `MeetingWarningProcessor` đã đăng ký trong `LiveMeetingModule.providers[]`.
- [ ] Processor lắng nghe đúng queue `scheduler` (QUEUE_SCHEDULER).
- [ ] Job name `'meeting-time-warning'` được handle đúng trong processor.

### Branch A (Scenario 1)
- [ ] `notification_type = meeting_time_warning`, `priority = normal`.
- [ ] `payload_json.extensionAllowed = true`, `cta.type = request_extension`.
- [ ] `payload_json.conflictWithNextBooking = false`.
- [ ] `payload_json.warningLevel = standard` khi `remainingMinutes > 0`.

### Branch B (Scenario 2)
- [ ] `notification_type = meeting_time_conflict_warning`, `priority = high`.
- [ ] `payload_json.extensionAllowed = false`, `cta = null`.
- [ ] `payload_json.conflictWithNextBooking = true`, `payload_json.nextBooking` có `reservedStartTime`.
- [ ] `payload_json.warningLevel = strict` khi `remainingMinutes > 0`.

### Late Job (Scenario 7)
- [ ] `remainingMinutes` không bao giờ âm trong notification.
- [ ] `warningLevel = overdue` (Branch A + late) hoặc `urgent` (Branch B + late).
- [ ] Log WARN với độ trễ thực tế.

### Conflict Buffer (Scenario 3)
- [ ] Branch B kích hoạt khi `nextBooking.reserved_start_time <= meeting.end_time + bufferMs`.
- [ ] Branch A khi ngoài buffer.
- [ ] Config invalid → default 0, log WARN.

### WebSocket Split (AC-010)
- [ ] Host nhận `emitToUser(hostId, ...)` với `extensionAllowed` trong payload.
- [ ] Meeting room nhận `emitToRoom(...)` với safe payload (không có `extensionAllowed`).

### Post-notification Writes
- [ ] `background_jobs.status = completed` sau thành công.
- [ ] `meeting_events.event_type = warning_sent`, `source_type = scheduler`, `actor_user_id = null`.
- [ ] `meeting_events.metadata_json` chứa `warningType`, `warningLevel`, `notificationId`, `conflictBufferMinutes`.

### Error Resilience
- [ ] Meeting not found → ACK, không notification, log ERROR.
- [ ] Meeting not in_progress → ACK, không notification, log WARN.
- [ ] Idempotency: duplicate job → ACK, không duplicate, log INFO.
- [ ] Conflict query lỗi → fallback Branch A, vẫn gửi notification.
- [ ] Notification tạo thất bại → NACK (throw), `background_jobs = failed`.
- [ ] WebSocket thất bại → ACK, `background_jobs = completed`, `meeting_events` vẫn tạo.
