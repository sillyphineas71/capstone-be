# Research: UC-AA-07 / UC-154 — Thống kê tỷ lệ cuộc họp bị hủy

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module

- Đã có 5 feature (`dashboard-overview`, `room-usage-dashboard`, `meeting-count-by-period`, `meeting-status-breakdown`, `meeting-average-duration`) trong `src/modules/analytics/`. Feature này bổ sung 1 controller/service/repository/dto mới, không tạo module mới.
- Permission `analytics.meeting.read` **đã seed** ở UC-AA-04 — dùng chung, không seed lại.

### Meeting cancellation flow (field thật, không suy đoán)

- `MeetingEntity` ([meeting.entity.ts](../../../../src/modules/meetings/entities/meeting.entity.ts)): `id, organizerId, roomId, status, startTime, cancellationReason, updatedBy, deletedAt`. **Không có cột `cancelledBy`/`cancelledAt` riêng.**
- `meetings.service.ts:1971-2358` (`cancelMeeting`): dùng 1 trong 2 permission `meeting.cancel.own` (organizer tự hủy) hoặc `meeting.cancel.any` (approver/admin hủy hộ) — người thực hiện hành động hủy **không nhất thiết** là `organizerId`. Actor được ghi vào `meetings.updated_by` (bị ghi đè bởi bất kỳ update nào khác, không đáng tin làm nguồn ranking dài hạn) và `meeting_events.actor_user_id` (đúng nhưng cần JOIN thêm bảng event, không dùng theo quyết định §0.2 spec.md).
- Reject phê duyệt cũng set `meetings.status='cancelled'` (đã xác nhận ở [feat-review-meeting-request/spec.md:144](../../../../spec/features/meeting/feat-review-meeting-request/spec.md)) — hội tụ về cùng giá trị với hủy chủ động, không cần UNION `meeting_requests` (tái dùng kết luận UC-AA-05 §0.4).

### UserEntity / DepartmentEntity (field thật)

- `UserEntity` ([user.entity.ts](../../../../src/modules/accounts/entities/user.entity.ts)): `id, email, fullName, departmentId`.
- `DepartmentEntity`: `id, departmentName, managerUserId`.

### Tái dùng hạ tầng đã có

- `DashboardOverviewConfigService.getMaxRangeDays()` — tái dùng nguyên vẹn (UC-AA-01).
- Pattern `resolveScope()` tĩnh theo `departments.manager_user_id` — tái dùng nguyên vẹn (UC-AA-01/04/05/06).
- Pattern `generateBuckets(from, to, granularity)` — tái dùng nguyên vẹn từ UC-AA-04 (chỉ `week`/`month`, KHÔNG cần thêm `quarter` ở granularity — khác UC-AA-06, vì `quarter` ở UC-AA-07 chỉ là 1 giá trị của `preset` khoảng lọc tổng thể, không phải đơn vị bucket trục hoành).
- Pattern `departmentIds` (mảng, ownership check multi-select) — tái dùng nguyên vẹn (UC-AA-05/06).
- Định nghĩa `meetingCount`/mẫu số (`status <> 'draft'`) — tái dùng nguyên vẹn UC-AA-01 FR-026.

### API Contract

- UC-154 (`docs/API_CONTRACT_v1.0_with_system_roles.md:5002-5025`): `GET /api/v1/analytics/meetings/cancel-rate`, permission `analytics.meeting.read`, roles `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`, query mẫu `from/to/departmentId`, response `{cancelledCount, totalMeetingCount, cancelRate, series: []}`.
- **Khoảng trống lớn**: response mẫu không có `topOrganizers`/`topDepartments` dù Normal Flow bước 5 của UC-AA-07 yêu cầu rõ "Bảng xếp hạng cảnh báo". Đã quyết định mở rộng thẳng endpoint hiện có thay vì tách endpoint mới (spec.md §0.1).
- Query mẫu gốc không có `preset`, `granularity`, `roomId`, `organizerEmail` — đều là bổ sung mới theo yêu cầu trực tiếp Normal Flow bước 3 (spec.md §0.10-§0.13).

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã có 5 feature) | Không tạo module mới |
| Permission | Tái dùng `analytics.meeting.read` | Đã seed ở UC-AA-04 |
| Endpoint | Mở rộng response UC-154 hiện có, không tách endpoint mới | Nhất quán cách xử lý bổ sung field ở UC-AA-01/05; giảm số lượng endpoint FE phải gọi |
| Scope resolution | Tái dùng pattern tĩnh UC-AA-01/04/05/06 | Không phụ thuộc kỳ lọc |
| Ranking basis | Theo `organizer_id`, không theo actor hủy | Xác nhận qua code: actor hủy không đáng tin cậy làm nguồn ranking (`updated_by` bị ghi đè bởi update khác); khớp mục tiêu nghiệp vụ + filter `organizerEmail` đã có |
| Bucket generation | Tái dùng nguyên `generateBuckets()` từ UC-AA-04 (`week`/`month`, KHÔNG thêm `quarter`) | `quarter` chỉ dùng cho `preset` (khoảng lọc), không phải granularity bucket |
| Preset khoảng lọc | Enum mới `month_current/month_previous/quarter/custom`, tách biệt hoàn toàn khỏi `granularity` | Đáp ứng đúng ví dụ Normal Flow bước 3 ("Tháng trước, Quý 1, tùy chỉnh") |
| Ngưỡng ranking | `organizedCount >= 3` (hardcode, không tạo `system_configs` key) | Chống nhiễu tỷ lệ 100% trên mẫu quá nhỏ; giữ đơn giản theo CLAUDE.md |
| Max range config | Tái dùng `analytics.dashboard_max_range_days` | Không tạo config trùng lần thứ 5 |
| Validation | class-validator + `ValidationPipe` per-route | Đồng nhất toàn repo |
| DB changes | None | Read-only, không bảng/cột/config key mới |

## Risks

| Risk | Mitigation |
|---|---|
| GROUP BY theo `organizer_id`/`department_id` trên toàn bộ `meetings` trong range lớn có thể chậm | 1 query aggregate riêng cho top lists (không lồng trong vòng lặp), giới hạn bởi `analytics.dashboard_max_range_days`, index sẵn có trên `meetings(organizer_id)`, `users(department_id)` |
| Ngưỡng `organizedCount >= 3` là giả định nghiệp vụ, không có trong BR gốc | Ghi rõ trong spec.md §0.5/CL-2, dễ nâng cấp thành `system_configs` sau nếu cần |
| Nhầm ranking theo actor hủy thay vì organizer (rủi ro code sai vì cả 2 đều có sẵn trong `meetings`) | Unit test cụ thể: meeting bị approver reject (actor ≠ organizer) vẫn tính vào `cancelledCount` của organizer gốc (AC-008 spec.md) |
| `topDepartments` vô tình trả dữ liệu cho MANAGER (rò rỉ thông tin phòng ban khác) | Unit test cụ thể verify `topDepartments=[]` tuyệt đối khi `role=MANAGER`, bất kể query params |
| `preset=quarter` tính sai biên quý | Unit test cụ thể cho từng quý, đặc biệt Q1 (biên năm) |
| Lệch với `API_CONTRACT` UC-154 gốc (thiếu nhiều field mới) | Ghi rõ trong `contracts/meeting-cancel-rate-api.md`, đề xuất đồng bộ tài liệu ở task riêng |
