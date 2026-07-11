# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Tạo mới research.md cho UC-RUM-04 (bổ sung sau spec.md/plan.md/tasks.md đã có từ 2026-07-09), tổng hợp lại phân tích codebase + tham khảo ngành để đồng bộ với các feature khác cùng đợt | Toàn bộ file |

---

# Research: View Room Usage History (UC-RUM-04)

## 1. Codebase Analysis

### Quan hệ với UC-AA-02 — mở rộng, không phải tính năng độc lập

`analytics` module đã có `feat-view-room-usage-dashboard` (UC-AA-02, đã ship) với 2 endpoint:
- `GET /api/v1/analytics/rooms/dashboard` — so sánh nhiều phòng, 1 dòng/phòng.
- `GET /api/v1/analytics/rooms/{roomId}/detail` — chi tiết 1 phòng.

Cả 2 đều KHÔNG trả về "danh sách phẳng, đa phòng, mỗi dòng = 1 phiên sử dụng" mà UC-RUM-04 cần (Normal Flow bước 6, Phần 2). Đây là lý do chính đáng để thêm 1 endpoint mới thay vì tái dùng endpoint cũ trực tiếp, nhưng toàn bộ hạ tầng phụ trợ (resolve `preset`/`from`/`to`, scope Manager theo kỳ lọc, guard `DATE_RANGE_TOO_LARGE`) đã có sẵn ở `RoomUsageDashboardService` và được tái dùng nguyên vẹn — không viết lại logic đã kiểm chứng.

### Nguồn "trạng thái phiên" — xác nhận field thật, không suy đoán

`RoomBookingUsageEntity.usageStatus` (enum `RoomUsageStatus`: `NOT_STARTED | IN_USE | COMPLETED | NO_SHOW | EARLY_EMPTY | RELEASED`) là nguồn trực tiếp cho phần lớn `sessionStatus`. Điểm quan trọng: `no_show_cases` (bảng workflow xử lý cảnh báo/giải phóng no-show) KHÔNG phải nguồn hiển thị trạng thái cuối — tránh nhầm lẫn 2 bảng có vẻ liên quan nhưng phục vụ mục đích khác nhau (giống phân biệt `equipment` vs `iot_devices` mà CLAUDE.md đã nhấn mạnh cho domain khác).

`room_bookings` không có cột `cancelled_at` chính danh — phải dùng `updated_at` làm proxy (đã ghi rõ giới hạn ở CL-1, không tự ý thêm cột theo nguyên tắc CLAUDE.md §5.4 "Không tự ý thêm bảng/cột mới khi chưa có yêu cầu rõ ràng").

### Đã xác nhận: đây là feature CHƯA có code

Grep toàn bộ `capstone-be/src` cho "usage-history"/"RoomUsageHistory"/"room_usage_history" không trả về kết quả nào — xác nhận đây vẫn đang ở giai đoạn spec/plan/tasks (task-list `tasks.md` toàn bộ `[ ]` chưa checked), chưa bắt đầu implement.

## 2. Tham khảo thực tế ngành

| Nguồn | Pattern | Áp dụng vào UC-RUM-04 |
|---|---|---|
| **Google Analytics / Looker Studio "date range comparison"** | Dashboard lịch sử luôn tách biệt "summary metrics" (tổng hợp toàn kỳ) khỏi "detail table" (phân trang) — 2 khối tính riêng, không suy ra summary từ trang hiện tại | Xác nhận thiết kế NFR-005 (summary tính trên toàn bộ tập kết quả, độc lập với `page`/`limit`) là best practice chuẩn ngành, không phải quá kỹ lưỡng không cần thiết |
| **Audit-log style history views (vd AWS CloudTrail Event history)** | Luôn hiển thị đầy đủ mọi bản ghi kể cả những bản ghi ở trạng thái trung gian/đang xử lý, gắn nhãn trạng thái rõ ràng thay vì ẩn — tránh gây hiểu lầm "mất dữ liệu" | Củng cố quyết định CL-2 (giữ hiển thị `pending_evaluation` với nhãn trung tính thay vì ẩn) — ẩn dữ liệu khỏi audit/history view là anti-pattern vì người xem không biết có bỏ sót gì không |
| **Room-booking SaaS (Robin, Envoy, Skedda) — usage/no-show report** | Report lịch sử luôn có sẵn 1 nút Export ngay trên cùng màn hình, nhưng xử lý export tách biệt hoàn toàn khỏi API hiển thị (thường generate lại phía server, không "in ra" đúng những gì đang phân trang trên UI) | Củng cố quyết định §0.5 (A1 Export ngoài phạm vi feature này, đề xuất `feat-export-room-usage-report` riêng dùng chính endpoint này làm nguồn dữ liệu — không export trực tiếp response đã phân trang) |

## 3. Quyết định kỹ thuật xác nhận lại (Technology Decisions)

| Decision | Chọn | Lý do |
|---|---|---|
| Endpoint | `GET /api/v1/analytics/rooms/usage-history` | Đặt trong `analytics` (không phải `reports`/`rooms`) — nhất quán vị trí các endpoint đọc dashboard khác của module này |
| Nguồn trạng thái phiên | `room_booking_usages.usage_status` (ưu tiên) + `room_bookings.status`/`updated_at` (cho cancelled/cancelled_late) | Tránh nhầm với `no_show_cases` (workflow, không phải nhãn hiển thị cuối) |
| Summary vs Detail | 2 query tách biệt, summary KHÔNG giới hạn bởi phân trang | Chuẩn ngành cho dashboard lịch sử (xem §2) |
| Default preset | `month` (giữ theo CL-4 đã chốt 2026-07-10) | Nhất quán UC-AA-02 trong cùng module, tránh 2 quy ước mặc định |
| `pending_evaluation` | Hiển thị với nhãn trung tính, không ẩn (giữ theo CL-2 đã chốt 2026-07-10) | Tránh anti-pattern ẩn dữ liệu khỏi audit/history view |
| Export (A1) | Ngoài phạm vi, đề xuất feature riêng dùng chính endpoint này làm nguồn | Nhất quán pattern đã áp dụng ở `feat-export-room-utilization-report` (UC-RUM-16) — worker export luôn tính lại server-side, không "in" từ response FE |

## 4. Risks

- **`updated_at` làm proxy cho `cancelled_at`** (CL-1): nếu sau này có nghiệp vụ khác cũng update booking đã `CANCELLED` (hiện chưa có), proxy này sẽ cho kết quả sai — cần giám sát khi thêm nghiệp vụ mới liên quan `room_bookings`.
- **Danh sách lớn khi lọc theo Tháng/toàn tổ chức**: đã giảm thiểu bằng bắt buộc phân trang (FR-012) + giới hạn `analytics.dashboard_max_range_days` (FR-022), nhất quán UC-AA-01/02.
- **`sessionStatus` phụ thuộc cron chưa chạy kịp**: `pending_evaluation` là dấu hiệu cron no-show/actual-usage chậm — nếu tần suất xuất hiện cao trong thực tế vận hành, có thể là tín hiệu cần điều chỉnh lịch cron (`SCHEDULER_NO_SHOW_CHECK_CRON`), không phải lỗi của feature này.
