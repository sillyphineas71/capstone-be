# Quickstart: UC-RUM-04 — Xem lịch sử sử dụng phòng họp theo khoảng thời gian

## 1. Kịch bản test thủ công (happy path)

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v1/analytics/rooms/usage-history?preset=month&page=1&limit=20" | jq '.data.summary, .meta'
```

Kỳ vọng: `summary` có đủ 5 field (`totalReservedHours/totalActualHours/noShowCount/reservationUtilizationRate/roomOccupancyRate`), `meta.total` khớp tổng số booking thật trong tháng hiện tại (không bị giới hạn bởi `limit=20`).

## 2. Kịch bản test sort (Normal Flow bước 7)

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v1/analytics/rooms/usage-history?preset=month&sortBy=sessionStatus&sortOrder=asc" \
  | jq '.data.sessions[].sessionStatus'
```

Kỳ vọng: danh sách `sessionStatus` xuất hiện theo thứ tự tăng dần (alphabet), giúp gom nhanh các dòng `no_show` lại gần nhau.

## 3. Kịch bản test scope Manager (BR1)

1. Đăng nhập user role `MANAGER` quản lý phòng ban "Kỹ thuật", đã đặt phòng "P101" trong kỳ lọc.
2. Gọi endpoint không truyền `roomId`.
3. Kỳ vọng: `sessions[]` chỉ chứa các phiên của phòng do phòng ban "Kỹ thuật" đặt (không thấy phòng của phòng ban khác), test bằng cách so sánh với response của 1 tài khoản `BUSINESS_ADMIN` (phải thấy nhiều hơn).

## 4. Kịch bản test cancelled_late (FR-DATA-002/FR-DATA-003)

1. Tạo 1 booking, hủy trong vòng 60 phút trước giờ bắt đầu dự kiến (giá trị mặc định `analytics.late_cancellation_threshold_minutes`).
2. Gọi endpoint cho khoảng thời gian chứa booking đó.
3. Kỳ vọng: `sessionStatus='cancelled_late'` cho dòng tương ứng; nếu hủy sớm hơn ngưỡng (vd 2 ngày trước), kỳ vọng `sessionStatus='cancelled'`.

## 5. Kịch bản test Exception E1 (rỗng) và E2 (range quá dài)

```bash
# E1 — khoảng thời gian tương lai, chắc chắn không có booking
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v1/analytics/rooms/usage-history?preset=custom&from=2030-01-01&to=2030-01-31" \
  | jq '.message, .data.sessions'

# E2 — range vượt quá analytics.dashboard_max_range_days
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v1/analytics/rooms/usage-history?preset=custom&from=2020-01-01&to=2026-07-01" \
  | jq '.error.code, .message'
```

Kỳ vọng: E1 trả HTTP 200 với `sessions=[]` + message đúng nội dung UC; E2 trả HTTP 400 `DATE_RANGE_TOO_LARGE`.
