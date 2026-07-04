# Research: UC-AA-05 / UC-152 — Thống kê cuộc họp theo trạng thái

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module
- Đã có `dashboard-overview.*` (UC-AA-01), `room-usage-dashboard.*` (UC-AA-02), `meeting-count-by-period.*` (UC-AA-04) trong `src/modules/analytics/`. Feature này bổ sung 1 controller/service/repository/dto mới, tái dùng tối đa config/scope helper đã có.
- Permission `analytics.meeting.read` **đã được seed** ở UC-AA-04 — feature này **dùng chung**, không seed lại.

### Xác nhận luồng "Cancelled" hội tụ 1 giá trị (đọc code thật)
- `spec/features/meeting/feat-review-meeting-request/spec.md` FR-018: "WHILE `meetings.status` đang ở trạng thái `pending_approval`, THE system SHALL cho phép chuyển sang `scheduled` (khi approve) hoặc `cancelled` (khi reject)." → reject luôn set `meetings.status='cancelled'`, giống hệt hủy chủ động.

### Xác nhận No-show KHÔNG mutate `meetings.status` (đọc code thật)
- `spec/features/room-utilization/feat-no-show-lifecycle/spec.md` §0.1: "Release mutate booking + usage + no_show_case (+ room_event), **KHÔNG đụng rooms và KHÔNG hủy meetings**." → meeting bị no-show vẫn giữ nguyên `status` cũ (thường là `scheduled`), chỉ nhận biết qua `no_show_cases`.
- `NoShowCaseEntity`: `bookingId, meetingId, roomId, detectionStatus` (`risk|confirmed|warning_sent|released|dismissed|resolved`) — dùng `detection_status IN ('confirmed','released')` để xác định no-show đã xác nhận (đúng định nghĩa `noShowRate` đã dùng ở UC-AA-01).

### MeetingEntity, RoomBookingEntity (field thật)
- `MeetingEntity`: `id, organizerId, roomId, status (enum MeetingStatus), startTime, deletedAt`.
- `RoomBookingEntity`: `id, meetingId, roomId, status`.
- Join path No-show: `meetings.id = room_bookings.meeting_id`, `room_bookings.id = no_show_cases.booking_id`.

### Tái dùng hạ tầng đã có
- `DashboardOverviewConfigService.getMaxRangeDays()` — tái dùng nguyên vẹn (UC-AA-01).
- Pattern `resolveScope()` tĩnh theo `departments.manager_user_id` — tái dùng nguyên vẹn (UC-AA-01/UC-AA-04).
- Pattern `preset=day|week|month|custom` + `resolveDateRange()` — tái dùng nguyên vẹn (UC-AA-02).

### API Contract
- UC-152 (`docs/API_CONTRACT_v1.0_with_system_roles.md:4945-4970`): `GET /api/v1/analytics/meetings/status-breakdown`, permission `analytics.meeting.read`, roles `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`, query mẫu `from/to/departmentId` (số ít). Response mẫu có 4 mục `completed/cancelled/scheduled/in_progress` — **không có `no_show`**.
- Quyết định: đổi `departmentId` → `departmentIds` (mảng, theo yêu cầu multi-select), đổi `in_progress` → `no_show` trong response (theo BR1 gốc của UC-AA-05) — đã ghi RECON trong spec.md §0.6, §0.8.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã tồn tại, đã có code UC-AA-01/02/04) | Không tạo module mới |
| Permission | Tái dùng `analytics.meeting.read` (đã seed ở UC-AA-04) | Cùng permission theo `API_CONTRACT`, tránh seed trùng |
| Scope resolution | Tái dùng đúng pattern tĩnh của UC-AA-01/04 | Không phụ thuộc kỳ lọc (khác UC-AA-02) |
| Date range | Tái dùng `preset` pattern của UC-AA-02 | Vì đây là 1 lát cắt thời gian, không phải time-series |
| Max range config | Tái dùng `analytics.dashboard_max_range_days` | Không tạo config trùng lần thứ 3 |
| No-show detection | JOIN `meetings → room_bookings → no_show_cases`, `detection_status IN ('confirmed','released')` | Đúng định nghĩa đã dùng ở UC-AA-01, nhất quán toàn hệ thống |
| Validation | class-validator + `ValidationPipe` per-route | Đồng nhất toàn repo |
| DB changes | None | Read-only, không config key mới |

## Risks

| Risk | Mitigation |
|---|---|
| Query JOIN 3 bảng (`meetings`/`room_bookings`/`no_show_cases`) có thể chậm nếu thiếu index | `no_show_cases(booking_id)`, `room_bookings(meeting_id)` đã có index sẵn theo baseline schema |
| Precedence phân loại (§0.3 spec.md) implement sai thứ tự → đếm trùng/sót | Unit test cụ thể cho từng nhánh: cancelled trước, no-show trước completed/scheduled |
| Lệch với `API_CONTRACT` UC-152 gốc (`in_progress` → `no_show`, `departmentId` → `departmentIds`) | Ghi rõ trong `contracts/meeting-status-breakdown-api.md`, đề xuất đồng bộ tài liệu ở task riêng |
