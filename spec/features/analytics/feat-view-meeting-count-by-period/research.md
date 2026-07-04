# Research: UC-AA-04 / UC-151 — Thống kê số lượng cuộc họp theo khoảng thời gian

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module
- Đã có `dashboard-overview.*` (UC-AA-01) và `room-usage-dashboard.*` (UC-AA-02) trong `src/modules/analytics/`. Feature này bổ sung thêm 1 controller/service/repository/dto nhỏ gọn hơn (chỉ 1 endpoint, không có drill-down).
- Permission `analytics.meeting.read` chưa được seed (grep repo không ra kết quả).

### Tái dùng hạ tầng đã có từ UC-AA-01
- `DashboardOverviewConfigService.getMaxRangeDays()` — tái dùng nguyên vẹn, không viết lại logic `analytics.dashboard_max_range_days`.
- Pattern `resolveScope()` (role check qua `AuthzReadRepository.getEffectiveRolesAndPermissions` + query `departments WHERE manager_user_id = :userId`) — tái dùng đúng logic tĩnh (khác UC-AA-02 vốn theo kỳ lọc).

### MeetingEntity (field thật)
- `id, organizerId, hostId, roomId, meetingType (enum MeetingType), status (enum MeetingStatus), startTime, endTime, deletedAt` (`src/modules/meetings/entities/meeting.entity.ts`).
- `MeetingStatus`: `draft|pending_approval|scheduled|in_progress|completed|cancelled`.
- `MeetingType`: `normal|training|interview|emergency`.

### API Contract
- UC-151 (`docs/API_CONTRACT_v1.0_with_system_roles.md:4917-4941`): `GET /api/v1/analytics/meetings/count-by-period`, permission `analytics.meeting.read`, roles `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`, query `from/to/granularity/departmentId`, response `{total, series:[{period,count}]}`.
- Thiếu `roomId`/`meetingType` — bổ sung theo quyết định đã duyệt (`spec.md` §0.3).
- UC-AA-04 (yêu cầu trực tiếp người dùng) không liệt kê `SYSTEM_ADMIN` trong Primary Actor nhưng `API_CONTRACT` có — giữ nguyên `SYSTEM_ADMIN` theo `API_CONTRACT` (`spec.md` §0.9).

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã tồn tại, đã có code UC-AA-01/02) | Không tạo module mới |
| Scope resolution | Tái dùng đúng pattern tĩnh của UC-AA-01 (không theo kỳ lọc như UC-AA-02) | `meetings.organizer_id` không phụ thuộc phòng cụ thể, nên scope Manager ổn định theo thời gian |
| Max range config | Tái dùng `analytics.dashboard_max_range_days` | Tránh tạo config trùng mục đích lần thứ 2 |
| Bucket generation | Sinh đủ bucket theo `granularity` trong `[from,to]` ở tầng service (JS date logic), JOIN kết quả COUNT từ DB vào từng bucket, bucket không có dữ liệu giữ `count=0` | Đáp ứng đúng §0.4 (EX1: series không rút gọn) |
| Validation | class-validator + `ValidationPipe` per-route | Đồng nhất toàn repo |
| DB changes | None | Read-only, không config key mới |

## Risks

| Risk | Mitigation |
|---|---|
| Phương án A (BR1) không cross-check thời gian có thể đếm nhầm `scheduled` quá hạn | Chấp nhận theo quyết định đã chọn; ghi rõ CL-2 trong spec.md để cân nhắc nâng cấp sau |
| Sinh bucket ISO week sai lệch múi giờ nếu không cố định `Asia/Ho_Chi_Minh` | Toàn bộ tính toán ngày/tuần/tháng dùng timezone cố định, giống UC-AA-02 |
| `roomId`/`meetingType` là field bổ sung ngoài `API_CONTRACT` gốc | Ghi rõ trong `contracts/meeting-count-by-period-api.md`, đề xuất đồng bộ tài liệu ở task riêng |
