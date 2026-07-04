# Research: UC-AA-06 / UC-153 — Thống kê thời lượng trung bình cuộc họp

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module
- Đã có 4 feature (`dashboard-overview`, `room-usage-dashboard`, `meeting-count-by-period`, `meeting-status-breakdown`) trong `src/modules/analytics/`. Feature này bổ sung 1 controller/service/repository/dto mới.
- Permission `analytics.meeting.read` **đã seed** ở UC-AA-04 — dùng chung, không seed lại.

### RoomBookingEntity / RoomBookingUsageEntity (field thật)
- `RoomBookingEntity`: `id, meetingId, roomId, reservedStartTime, reservedEndTime, status`.
- `RoomBookingUsageEntity`: `bookingId, meetingId, roomId, actualStartTime, actualEndTime, firstPresenceAt, lastPresenceAt`.
- Cả 2 bảng liên kết 1-1 với `meetings` qua `meeting_id` — giống cách đã dùng ở UC-AA-02 (`getUtilizationAggregate`/`getBookedAggregate`).

### Tái dùng hạ tầng đã có
- `DashboardOverviewConfigService.getMaxRangeDays()` — tái dùng nguyên vẹn (UC-AA-01).
- Pattern `resolveScope()` tĩnh theo `departments.manager_user_id` — tái dùng nguyên vẹn (UC-AA-01/04/05).
- Pattern `generateBuckets(from, to, granularity)` — tái dùng/mở rộng từ UC-AA-04, thêm nhánh `quarter`.
- Pattern `departmentIds` (mảng, ownership check multi-select) — tái dùng nguyên vẹn (UC-AA-05).
- Pattern fallback presence (`actual_* → presence_* → loại`) — tái dùng nguyên vẹn (UC-AA-01 FR-013 / UC-AA-02 FR-028).

### API Contract
- UC-153 (`docs/API_CONTRACT_v1.0_with_system_roles.md:4974-4998`): `GET /api/v1/analytics/meetings/average-duration`, permission `analytics.meeting.read`, roles `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`, query mẫu `from/to/mode/departmentId`, response `{averageMinutes, medianMinutes, series:[{period,averageMinutes}]}`.
- Không khớp yêu cầu UC-AA-06 (đối chiếu song song dự kiến/thực tế) — đã quyết định bỏ `mode`/`medianMinutes`, đổi `departmentId`→`departmentIds`, thêm `roomId`, response trả song song `plannedAverageMinutes`/`actualAverageMinutes` (xem spec.md §0.2, §0.8, §0.9).

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã có 4 feature) | Không tạo module mới |
| Permission | Tái dùng `analytics.meeting.read` | Đã seed ở UC-AA-04 |
| Scope resolution | Tái dùng pattern tĩnh UC-AA-01/04/05 | Không phụ thuộc kỳ lọc |
| Bucket generation | Mở rộng `generateBuckets()` (nếu tái dùng được từ UC-AA-04) thêm nhánh `quarter`; nếu không tái dùng trực tiếp được do coupling, implement lại 1-1 cùng logic | Nhất quán label style |
| Population | Chỉ `meetings.status='completed'`, cùng 1 tập N cho cả 2 giá trị (Phương án A) | Đã duyệt — đảm bảo so sánh công bằng |
| Max range config | Tái dùng `analytics.dashboard_max_range_days` | Không tạo config trùng lần thứ 4 |
| Validation | class-validator + `ValidationPipe` per-route | Đồng nhất toàn repo |
| DB changes | None | Read-only, không config key mới |

## Risks

| Risk | Mitigation |
|---|---|
| JOIN `meetings + room_bookings + room_booking_usages` cho mỗi bucket có thể chậm nếu range lớn + granularity=day | 1 query `GROUP BY date_trunc` (không N+1), index sẵn có trên `meeting_id` các bảng |
| Nhầm lẫn `0` vs `null` khi bucket rỗng (dễ code sai mặc định trả 0) | Unit test T-cụ-thể verify `null` chứ không phải `0` khi `completedMeetingCount=0` |
| `quarter` bucket tính sai biên (Q1-Q4, năm nhuận không ảnh hưởng nhưng cần đúng ngày bắt đầu quý) | Unit test cụ thể cho từng quý, đặc biệt Q1 (Jan-Mar) |
| Lệch với `API_CONTRACT` UC-153 gốc (`mode`, `medianMinutes` bị bỏ) | Ghi rõ trong `contracts/meeting-average-duration-api.md`, đề xuất đồng bộ tài liệu ở task riêng |
