# Quickstart: UC-RUM-16 — Xuất báo cáo sử dụng phòng họp

## 1. Kịch bản test thủ công (happy path — PDF)

1. Đảm bảo có ít nhất vài `room_bookings` trong tháng trước (status `completed`/`approved`).
2. Gọi API tạo job, poll tới khi hoàn tất, tải file.

```bash
JOB=$(curl -s -X POST http://localhost:3000/api/v1/reports/room-utilization/exports \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-06-30","format":"pdf"}' | jq -r '.data.jobId')

until [ "$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/v1/background-jobs/$JOB | jq -r '.data.status')" = "completed" ]; do
  sleep 1
done

curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/v1/background-jobs/$JOB | jq '.data'
```

3. Kỳ vọng: `status='completed'`, `outputFileId` khác null, file PDF tải về có đủ 5 phần theo `contracts/room-utilization-export-api.md`.

## 2. Kịch bản test BR1 (WYSIWYG)

1. Gọi `GET /api/v1/analytics/rooms/utilization-rate?from=2026-06-01&to=2026-06-30` (endpoint dashboard đã có), ghi lại `reservationUtilizationRate`.
2. Export báo cáo với đúng `from/to` đó.
3. Kỳ vọng: số liệu trong file (Phần "Utilization Rate") khớp chính xác con số đã ghi ở bước 1 (không làm tròn khác, không lệch công thức).

## 3. Kịch bản test Exception E1

1. Gọi API với `from`/`to` ở tương lai xa (chắc chắn không có booking nào).
2. Kỳ vọng: HTTP 422 ngay lập tức (không tạo job), `error.code='EMPTY_DATA_SET'`, message "Không có dữ liệu trong khoảng thời gian đã chọn. Không thể xuất báo cáo."

## 4. Kịch bản test CSV row-level

1. Gọi API với `format=csv` cho 1 khoảng có cả booking bình thường VÀ ít nhất 1 trường hợp no-show đã confirmed VÀ 1 trường hợp phòng bị release (auto hoặc thủ công).
2. Kỳ vọng: file CSV có N dòng = N `room_booking_usages`, dòng no-show có `isNoShow=true`, dòng bị release có `isReleased=true` + `releaseType` đúng (`room_auto_released`/`room_manual_released`).

## 5. Kịch bản test phân quyền

1. Gọi API bằng token của user role `MANAGER` hoặc `INTERNAL_USER`.
2. Kỳ vọng: HTTP 403 `PERMISSION_DENIED` (chỉ `BUSINESS_ADMIN`/`SYSTEM_ADMIN` được phép — khác UC-AA-12 vốn cho phép cả Manager).
