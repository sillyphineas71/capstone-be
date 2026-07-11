# Quickstart: UC-SM-02 — Chọn khung giờ họp tối ưu

## 1. Kịch bản test thủ công (happy path)

1. Tạo 2 user test (`manager-a`, `manager-b`) và cho `manager-b` có 1 meeting `status=scheduled` từ 09:00-10:00 ngày mai.
2. Gọi API với `requiredParticipantUserIds=[manager-a, manager-b]`, `searchRangeStart=hôm nay`, `searchRangeEnd=+3 ngày`, `durationMinutes=60`.
3. Kỳ vọng: kết quả KHÔNG chứa slot nào overlap [09:00-10:00] ngày mai của `manager-b`; các slot khác trong range có `matchScore=100`.

```bash
curl -X POST http://localhost:3000/api/v1/scheduling/time-suggestions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "requiredParticipantUserIds": ["<manager-a-id>", "<manager-b-id>"],
    "searchRangeStart": "2026-07-11T00:00:00+07:00",
    "searchRangeEnd": "2026-07-14T23:59:59+07:00",
    "durationMinutes": 60
  }'
```

## 2. Kịch bản test AF1 (khung giờ có người bận — chỉ Optional)

1. Thêm `optionalParticipantUserIds=[emp-c]`, cho `emp-c` bận toàn bộ range.
2. Kỳ vọng: các slot vẫn xuất hiện (vì `emp-c` là Optional, không phải hard filter) nhưng `matchScore < 100` và `busyParticipants` chứa `emp-c` với `busyFrom`/`busyTo`, không chứa tiêu đề meeting.

## 3. Kịch bản test EX1 (không tìm thấy)

1. Cho TẤT CẢ Required participant bận kín toàn bộ search range (đặt các meeting `scheduled` nối tiếp nhau phủ hết range).
2. Gọi API cùng range đó.
3. Kỳ vọng: HTTP 200, `data: []`, message "Không tìm thấy khung giờ chung nào phù hợp..."

## 4. Sau khi chọn 1 slot

Frontend lấy `startTime`/`endTime` từ item được chọn, điền vào biểu mẫu tạo meeting (`POST /api/v1/meetings`), sau đó có thể gọi `GET /api/v1/scheduling/room-suggestions` (UC-SM-01) với đúng `startTime`/`endTime` đó để tìm phòng — 2 bước tách biệt theo Quyết định D4 trong spec.md.
