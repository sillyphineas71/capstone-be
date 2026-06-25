# Specification Quality Checklist: Gửi cảnh báo kết thúc phiên họp và xung đột lịch (UC-IMM-13)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-19
**Feature**: [spec.md](../spec.md)

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-19 | Khởi tạo checklist cho UC-IMM-13 Gửi cảnh báo kết thúc phiên họp và xung đột lịch | Toàn bộ file |
| 2026-06-19 | Cập nhật sau clarification: tất cả 2 câu hỏi mở trong 1.5 đã được giải quyết; validation results cập nhật theo spec mới | Mục Content Quality, Validation Results, Notes |

---

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (tất cả câu hỏi mở trong 1.5 đã được giải quyết hoàn toàn)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

---

## Validation Results

| Item | Status | Notes |
|---|---|---|
| No implementation details | PASS | Spec tập trung vào WHAT/WHY. BullMQ/Redis là công nghệ đã được chọn cho project, không phải quyết định mới trong spec này |
| Focused on user value | PASS | Mỗi FR gắn với business outcome: cảnh báo đúng thời điểm, khóa UI gia hạn khi conflict, tránh notification sai sau khi meeting đã ended |
| All mandatory sections completed | PASS | 10 sections đầy đủ: Context, Actor, Business Rules, FR, NFR, Data Model, Dependencies, Error Handling, AC, Out of Scope |
| No [NEEDS CLARIFICATION] | PASS | Tất cả câu hỏi mở đã được giải quyết: conflict buffer (conflictBufferMinutes), WebSocket payload split. Không còn marker chờ |
| Requirements testable | PASS | Tất cả FR-001 → FR-037 dùng EARS keyword; mỗi FR trace được sang ít nhất 1 AC Gherkin scenario |
| Success criteria measurable | PASS | 11 Gherkin scenarios dùng Given/When/Then với dữ liệu cụ thể (timestamp, notification_type, extensionAllowed, warningType, warningLevel, reservedStartTime) |
| Edge cases identified | PASS | Meeting ended trước job fired (AC-003), meeting online no room_id (AC-004), conflict query DB fail → fallback Branch A (AC-005), notification fail (AC-006), WebSocket fail non-critical (AC-007), duplicate job idempotency (AC-008), late job remainingMinutes clamped (AC-009), WebSocket payload split Host/Participant (AC-010), conflict buffer window (AC-011) |
| Scope clearly bounded | PASS | Out of Scope liệt kê 10 items + 5 EARS guardrails; tách bạch rõ UC-IMM-13 không lập lịch, không gia hạn, không kết thúc meeting |
| AC traceability to FR | PASS | AC-001→FR-003/010, AC-002→FR-003/011, AC-003→ERR-002, AC-004→FR-015, AC-005→ERR-003, AC-006→ERR-005, AC-007→ERR-007, AC-008→FR-033, AC-009→FR-031/FR-032/BR-13~15, AC-010→FR-012/BR-17, AC-011→FR-003/FR-035 |
| Dependencies identified | PASS | Section 9 nêu đầy đủ: upstream UC-IMM-12, UC-IMM-01, UC-IMM-02, UC-IMM-03, UC-IMM-05; infrastructure BullMQ/Redis/PostgreSQL/WebSocket Gateway/NotificationsService |
| No new DB tables | PASS | Chỉ dùng `meetings`, `room_bookings`, `meeting_participants`, `notifications`, `meeting_events`, `background_jobs`, `system_configs` đã có trong DB v3.2 Compact. Chỉ thêm 2 enum values code-level vào `NotificationType` TypeScript enum |
| No HTTP endpoint mới | PASS | UC-IMM-13 là internal BullMQ job processor — không có API surface riêng |
| Two warning branches clearly defined | PASS | 4 warningLevel (standard/overdue/strict/urgent): Branch A+normal time→standard, Branch A+late→overdue, Branch B+normal→strict, Branch B+late→urgent. BR-04/BR-05, FR-010/FR-011, payload schemas 6.3, AC-001/AC-002/AC-009 |
| Extension lock mechanism | PASS | BR-06 xác nhận rõ `extensionAllowed: false` trong payload_json là cơ chế chính để frontend Host khóa UI gia hạn |
| Conflict buffer configurable | PASS | BR-03 + FR-035: đọc `meeting_warning_conflict_buffer_minutes` từ system_configs, default = 0, AC-011 test cả 2 trường hợp trong/ngoài buffer window |
| Late job handling | PASS | BR-13/14/15 + FR-031/FR-032: clamp remainingMinutes = 0, gửi warningLevel=overdue/urgent, không skip khi meeting còn in_progress |
| WebSocket payload separation | PASS | BR-17 + FR-012: Host nhận full payload, Participant/Room Display nhận safe payload; AC-010 verify |
| Correct DB column names | PASS | Spec dùng đúng `reserved_start_time`/`reserved_end_time` (không phải `reserved_start_at`) sau clarification |

---

## Notes

- All checklist items pass validation. Spec ready for `/speckit.plan`.
- UC-IMM-13 là **downstream consumer** của UC-IMM-12 — không thể implement UC-IMM-13 trước khi UC-IMM-12 stable và BullMQ queue `live-meeting-warnings` đã được cấu hình.
- **Thứ tự implement bắt buộc**: UC-IMM-12 (schedule job) → UC-IMM-13 (process job khi fired).
- Seed migration `system_configs` cần có key `meeting_warning_conflict_buffer_minutes` với giá trị mặc định `"0"` trước khi deploy.
- Hai enum values mới (`MEETING_TIME_WARNING`, `MEETING_TIME_CONFLICT_WARNING`) cần được thêm vào `NotificationType` trong `notification.entity.ts` trước khi implement service.
- `meeting_events.event_type = warning_sent` đã tồn tại trong `MeetingEventType` enum — không cần thêm mới.
- `background_jobs.job_type = meeting_time_warning` đã tồn tại trong `BackgroundJobType` enum — không cần thêm mới.
- Race condition giữa UC-IMM-05 (end meeting → cancel job) và UC-IMM-13 (job fired) được xử lý bởi guard check `meeting.status = in_progress` trong FR-013/FR-018.
- **Late job handling** (`remainingMinutes <= 0`): meeting vẫn `in_progress` → gửi overdue/urgent warning, không skip. Chỉ skip khi meeting đã ended hoặc duplicate idempotency.
- **WebSocket payload**: cần WebSocket Gateway hỗ trợ gửi payload khác nhau cho các connections khác nhau trong cùng một meeting room (Host connection vs Participant connection).
- Tên cột DB đúng là `reserved_start_time`/`reserved_end_time` trong `room_bookings` — xác nhận với entity trước khi implement.
