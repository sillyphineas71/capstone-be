# Research: UC-AA-02 / UC-149 — Dashboard sử dụng phòng họp

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module
- Đã có `dashboard-overview.*` từ UC-AA-01 trong `src/modules/analytics/`. Feature này bổ sung thêm controller/service/repository/dto riêng cho room dashboard trong cùng module — không tạo module mới.
- `analytics.room.read` permission chưa được seed (grep repo không ra kết quả) — cần seed mới, tương tự `analytics.overview.read`.

### Room / Booking / Usage entities (field thật, không suy đoán)
- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording, isActive, deletedAt` (`src/modules/rooms/entities/room.entity.ts`). Không có cột phòng ban.
- `RoomBookingEntity`: `id, bookingCode, meetingId, roomId, bookingType, reservedStartTime, reservedEndTime, status (enum RoomBookingStatus), bookedBy, approvedBy, approvedAt, cancellationReason`.
- `RoomBookingUsageEntity`: `id, bookingId, meetingId, roomId, reservedStartTime/EndTime, actualStartTime/EndTime, firstPresenceAt/lastPresenceAt, usageStatus, occupancySource`.
- Không có bảng nào liên kết `rooms` với `departments`.

### Scope resolution — tái dùng pattern UC-AA-01
- UC-AA-01 (`feat-view-dashboard-overview`) đã implement `resolveScope()` dựa trên `departments.manager_user_id = currentUser.id` rồi lọc `meetings.organizer_id`. Feature này tái dùng **đúng cách resolve phòng ban**, nhưng thêm 1 bước: từ tập phòng ban → JOIN `meetings` → JOIN `room_bookings` → DISTINCT `room_id` để ra tập phòng trong scope.
- Khác biệt quan trọng: scope phòng của UC-AA-02 **phụ thuộc kỳ lọc** (chỉ tính phòng đã được phòng ban đặt trong đúng khoảng `[from,to]` đang xem), không phải scope tĩnh — cần truyền `from/to` vào chính câu query resolve scope, không tách rời như UC-AA-01 (nơi scope phòng ban tĩnh, độc lập kỳ lọc).

### API Contract
- UC-149 (`docs/API_CONTRACT_v1.0_with_system_roles.md:4848-4883`) đã định nghĩa response mẫu: `summary.utilizationRate/totalBookedHours/actualUsedHours`, `rooms[].{roomId,roomName,utilizationRate,bookedHours,actualHours}`, `trend[]`. Field `utilizationRate` trong response mẫu tương ứng đúng nghĩa `roomOccupancyRate` theo thuật ngữ UC-AA-02 (thực tế ÷ đã đặt) — **không có field nào cho "Reservation Utilization Rate"** (đã đặt ÷ giờ mở cửa chuẩn). Quyết định: bổ sung 2 field tên riêng biệt thay vì tái dùng `utilizationRate` mơ hồ — xem `spec.md` §0.3.
- UC-49 (`docs/API_CONTRACT_v1.0_with_system_roles.md:1961-1993`) đã có sẵn export report (`POST /api/v1/rooms/usage-report/exports`, module `reports`, async `background_jobs`) — tái dùng nguyên trạng cho AF1, không viết lại.
- Không có endpoint nào cho drill-down chi tiết 1 phòng (heatmap + danh sách meeting) trong toàn bộ `API_CONTRACT` — endpoint `GET /api/v1/analytics/rooms/{roomId}/detail` là bổ sung mới hoàn toàn.

### system_configs — key mới
- Tái dùng đúng pattern `no_show.threshold_minutes` (`system_configs → env → default`) đã dùng ở UC-AA-01 cho `analytics.dashboard_max_range_days` (tái sử dụng nguyên key này, không tạo key range mới).
- Thêm 1 key mới: `analytics.room_operating_hours_per_day` (mặc định 8, env `ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY`).

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã tồn tại, đã có code từ UC-AA-01) | Không tạo module mới |
| Scope resolution | Raw SQL: `departments.manager_user_id` → `users.department_id` → `meetings.organizer_id` → `room_bookings.room_id` DISTINCT, có bind `from/to` | Vì scope phụ thuộc kỳ lọc, không thể tái dùng y nguyên hàm `resolveScope()` tĩnh của UC-AA-01 |
| Max range config | Tái dùng `analytics.dashboard_max_range_days` đã tạo ở UC-AA-01 | Tránh tạo 2 config trùng mục đích |
| Operating hours config | Key mới `analytics.room_operating_hours_per_day`, mặc định 8, áp dụng mọi ngày | Schema không có lịch làm việc; giữ đơn giản theo quyết định đã duyệt |
| Validation | class-validator + `ValidationPipe` per-route | Đồng nhất toàn repo (đã ghi nhận ở research UC-AA-01) |
| DB changes | None (chỉ thêm 1 config key) | Read-only |

## Risks

| Risk | Mitigation |
|---|---|
| Scope Manager theo kỳ lọc gây khó hiểu (phòng "biến mất" ở kỳ khác) | Ghi rõ trong spec §0.1 + assumption §1.4, test case AC-004/AC-007 |
| `reservationUtilizationRate` có thể > 100% nếu booking chồng lấn nhiều hơn giờ hành chính giả định | Không chặn > 100% ở tầng tính toán (đúng thực tế dữ liệu), chỉ log cảnh báo nếu cần (không phải business error) |
| Heatmap tính sai nếu 1 booking kéo dài qua nhiều khung giờ | Cộng dồn phút vào từng khung giờ theo tỷ lệ thời gian chồng lấn với từng giờ (không gán toàn bộ vào giờ bắt đầu) — cần cụ thể hóa ở plan.md |
| Endpoint `{roomId}/detail` không có trong API_CONTRACT gốc — rủi ro FE code sai theo tài liệu cũ | Ghi rõ trong `contracts/room-usage-dashboard-api.md` + đề xuất đồng bộ tài liệu gốc (Out of Scope) |
