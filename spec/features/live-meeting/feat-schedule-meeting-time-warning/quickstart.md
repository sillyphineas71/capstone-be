# Quickstart — Lập lịch cảnh báo thời gian còn lại (UC-IMM-12)

## Lưu ý quan trọng

UC-IMM-12 là **internal process** — không có HTTP endpoint riêng. Để test, cần trigger qua các UC caller (UC-IMM-01 start, UC-IMM-03 extension approve, UC-IMM-05 end) hoặc gọi trực tiếp service method trong integration test.

---

## Test Scenarios

### Scenario 1 — Happy Path: Start meeting → Warning scheduled

1. Tạo meeting với `status = scheduled`, `start_time = T-5m`, `end_time = T+50m`, có `host_id`.
2. Đảm bảo `system_configs` có row `config_key = 'meeting_warning_before_minutes', config_value = '10'`.
3. Gọi `POST /api/v1/live-meetings/{meetingId}/start` với JWT của host.
4. **Expect**: 200 OK, `data.status = in_progress`, `data.warningScheduledAt` trả về giá trị `end_time - 10m`.
5. Kiểm tra DB: `background_jobs` có record `job_type = meeting_time_warning`, `status = scheduled`, `scheduled_at ≈ end_time - 10m`.
6. Kiểm tra DB: `meeting_events` có record `event_type = warning_scheduled`, `source_type = scheduler`.
7. Kiểm tra BullMQ: queue `scheduler` có job với jobId `meeting-time-warning:{meetingId}`, delay ≈ 40 phút.

### Scenario 2 — AF1: Extension approved → Warning rescheduled

1. Start meeting thành công (Scenario 1 done).
2. Gọi `POST /api/v1/live-meetings/{meetingId}/extend` để tạo extension request.
3. Approve extension (tăng `end_time` thêm 30 phút).
4. **Expect**: BullMQ job cũ bị removed.
5. Kiểm tra DB: `background_jobs` record được UPDATE với `scheduled_at` mới = `end_time_mới - 10m`.
6. Kiểm tra DB: `meeting_events` có thêm record `event_type = warning_scheduled` mới (không phải update record cũ).
7. Kiểm tra BullMQ: job `meeting-time-warning:{meetingId}` trong queue với delay mới.

### Scenario 3 — AF2: remainingMinutes < configMinutes → Adjusted warning

1. Tạo meeting với `end_time = T+8m` (8 phút nữa kết thúc).
2. Config `meeting_warning_before_minutes = '10'`.
3. Gọi start meeting.
4. **Expect**: `data.warningScheduledAt ≈ now() + floor(8/2) = now() + 4m`.
5. Kiểm tra DB: `meeting_events.new_value_json.adjustedWarning = true`.
6. Kiểm tra DB: `background_jobs.input_json.adjustedWarningMinutes = 4`.

### Scenario 4 — AF3: End meeting → Warning cancelled

1. Start meeting thành công (warning job đã scheduled).
2. Gọi `POST /api/v1/live-meetings/{meetingId}/end`.
3. **Expect**: 200 OK, meeting ended.
4. Kiểm tra DB: `background_jobs.status = cancelled`.
5. Kiểm tra BullMQ: job `meeting-time-warning:{meetingId}` không còn trong queue.
6. Kiểm tra DB: KHÔNG có `meeting_events` với `event_type` mới từ UC-IMM-12 (AF3 không ghi event).

### Scenario 5 — Skip Guard: warningScheduledAt quá gần

1. Tạo meeting với `end_time = T+2m` (2 phút nữa kết thúc).
2. Config `meeting_warning_before_minutes = '10'`.
3. Gọi start meeting.
4. **Expect**: `data.warningSkipped = true`, `data.warningScheduledAt = null` (hoặc undefined).
5. Kiểm tra DB: KHÔNG có `background_jobs` record cho meeting này với `job_type = meeting_time_warning`.
6. Kiểm tra DB: `meeting_events` có record `event_type = warning_scheduling_skipped`, `source_type = scheduler`.
7. Kiểm tra BullMQ: KHÔNG có job `meeting-time-warning:{meetingId}` trong queue.

### Scenario 6 — Config missing → Default fallback

1. Đảm bảo `system_configs` KHÔNG có row `config_key = 'meeting_warning_before_minutes'`.
2. Start meeting với `end_time = T+60m`.
3. **Expect**: `data.warningScheduledAt ≈ end_time - 10m` (default 10 phút).
4. Kiểm tra log: có WARN `[readWarningConfig] config key not found, using default 10`.

### Scenario 7 — Idempotent: Start gọi 2 lần

1. Start meeting lần 1 → warning job enqueued.
2. Gọi start meeting lần 2 (idempotent, meeting đã `in_progress`).
3. **Expect**: Không có BullMQ "already exists" error thrown.
4. Kiểm tra BullMQ: chỉ có 1 job `meeting-time-warning:{meetingId}` (không bị duplicate).
5. Kiểm tra DB: `background_jobs` — chỉ có 1 record (không duplicate).

---

## Verification Checklist (Post-Implementation)

### Schema & Migration
- [ ] Migration chạy thành công: enum `meeting_event_type` có `warning_scheduled`, `warning_scheduling_skipped`.
- [ ] Migration chạy thành công: enum `background_job_type` có `meeting_time_warning`.
- [ ] Migration chạy thành công: enum `background_job_status` có `scheduled`.
- [ ] Seed: `system_configs` có row `meeting_warning_before_minutes = '10'`.

### Normal Flow (Scenario 1)
- [ ] `startMeeting()` trigger `scheduleWarningJob()` sau commit.
- [ ] `background_jobs` record được tạo với `status = scheduled`, `scheduled_at` đúng.
- [ ] `meeting_events` record `warning_scheduled` được tạo.
- [ ] `StartMeetingResponseDto.warningScheduledAt` trả về ISO string đúng.
- [ ] BullMQ job tồn tại trong queue `scheduler` với delay đúng.

### AF1 Reschedule (Scenario 2)
- [ ] `decideExtension()` approve trigger `rescheduleWarningJob()` sau commit.
- [ ] Job cũ bị removed khỏi BullMQ.
- [ ] `background_jobs` record được UPDATE với `scheduled_at` mới.
- [ ] `meeting_events` record `warning_scheduled` mới được INSERT (không update cũ).

### AF2 Adjusted Warning (Scenario 3)
- [ ] `adjustedWarningMinutes = Math.floor(remainingMinutes / 2)` tính đúng.
- [ ] `warningScheduledAt = now() + adjustedWarningMinutes`.
- [ ] `input_json.adjustedWarning = true` trong `background_jobs`.

### AF3 Cancel (Scenario 4)
- [ ] `endMeeting()` trigger `cancelWarningJob()` sau commit.
- [ ] BullMQ job bị removed.
- [ ] `background_jobs.status = cancelled`.
- [ ] KHÔNG tạo `meeting_events` mới khi cancel.

### Skip Guard (Scenario 5)
- [ ] Skip guard kích hoạt đúng khi `warningScheduledAt ≤ now() + 60s`.
- [ ] KHÔNG tạo `background_jobs` record khi skip.
- [ ] `meeting_events` có `warning_scheduling_skipped` event.
- [ ] `data.warningSkipped = true` trong response.

### Non-blocking (Error Resilience)
- [ ] BullMQ enqueue thất bại → `startMeeting()` vẫn trả 200 OK thành công.
- [ ] `background_jobs` write thất bại → `startMeeting()` không bị ảnh hưởng.
- [ ] `cancelWarningJob()` thất bại → `endMeeting()` vẫn trả 200 OK thành công.
