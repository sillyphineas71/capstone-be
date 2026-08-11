# API — Hành trình khuôn viên (User Journey)

Tài liệu API cho tính năng "Hành trình khuôn viên" ở trang [UserJourney.jsx](../../FE_SmarTracking/src/pages/shared/UserJourney.jsx)
(FE repo). Trang dùng **2 API**: một để tìm/chọn nhân viên (dropdown autocomplete),
một để lấy dữ liệu hành trình chính.

Base URL: `/api/v1` (global prefix, xem [main.ts](../src/main.ts)).

---

## 1. GET `/api/v1/campus/user-journey` — API chính (UC UJN-001)

Nguồn: [user-journey.controller.ts](../src/modules/gate-access/controllers/user-journey.controller.ts),
[user-journey.service.ts](../src/modules/gate-access/services/user-journey.service.ts),
[user-journey-response.dto.ts](../src/modules/gate-access/dto/user-journey-response.dto.ts).

Ghép 3 nguồn dữ liệu của MỘT người trong MỘT ngày thành 1 timeline:
1. `gate_access_logs` — xe qua cổng (ANPR)
2. `iot_device_events` (loại `ivss_face_event`) — có mặt phòng họp qua nhận diện khuôn mặt, đã **gộp phiên**
3. `zone_presence_events` — hiện diện khu vực giám sát (mọi zone của user, không hard-code zone cụ thể)

**Auth/Permission:** JWT + permission `zones.gate_log.read` (cấp cho `BUSINESS_ADMIN`, `MANAGER`, `SYSTEM_ADMIN`).

Để hiện ẢNH của sự kiện `gate`/`meeting` (xem `sourceEventId` bên dưới), FE gọi thêm
`GET /api/v1/ivss/device-events/:eventId/snapshot` — route này yêu cầu permission RIÊNG
`ivss.access_log.read` (từ 2026-08-09 đã cấp cho cả `BUSINESS_ADMIN`/`MANAGER`, trước đó
chỉ `SYSTEM_ADMIN` — xem migration `20260809000001-GrantAccessLogReadToBusinessAdminManager.ts`).
Chấp nhận token qua query string `?token=...` (dùng trực tiếp trong `<img src>`), không chỉ header.

### Query params

| Field | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `userId` | UUID v4 | Có | ID nhân viên cần xem hành trình |
| `date` | `YYYY-MM-DD` | Không | Mặc định = hôm nay theo giờ VN (Asia/Ho_Chi_Minh) nếu bỏ trống |

### Response mẫu

```json
{
  "success": true,
  "message": "User journey retrieved",
  "data": {
    "userId": "a1b2c3d4-...",
    "fullName": "Nguyễn Văn A",
    "date": "2026-08-11",
    "gateCount": 2,
    "meetingCount": 1,
    "zoneCount": 3,
    "events": [
      {
        "time": "2026-08-11T01:05:12.000Z",
        "type": "gate",
        "direction": "enter",
        "detail": "Xe 30G-699.46 vào Cổng chính",
        "zoneName": "Cổng chính",
        "plateNumber": "30G-699.46",
        "roomName": null,
        "meetingId": null,
        "sourceEventId": "d4e5f6a7-...."
      },
      {
        "time": "2026-08-11T02:39:00.000Z",
        "endTime": "2026-08-11T02:50:00.000Z",
        "type": "meeting",
        "direction": "session",
        "detail": "Có mặt A102 (11 phút)",
        "zoneName": null,
        "plateNumber": null,
        "roomName": "A102",
        "meetingId": "m-uuid-...",
        "sourceEventId": "b2c3d4e5-....",
        "durationMs": 660000,
        "eventCount": 5
      },
      {
        "time": "2026-08-11T03:00:00.000Z",
        "type": "zone",
        "direction": "appear",
        "detail": "Camera khu vực: xuất hiện tại Khu vực kho",
        "zoneName": "Khu vực kho",
        "plateNumber": null,
        "roomName": null,
        "meetingId": null,
        "sourceEventId": null
      }
    ]
  }
}
```

### Giải thích các trường trong `data`

| Field | Kiểu | Giải thích |
|---|---|---|
| `userId` | string | UUID nhân viên được truy vấn (echo lại từ query) |
| `fullName` | string \| null | Họ tên nhân viên; `null` nếu user đã bị xoá mềm |
| `date` | string | Ngày đang xem (`YYYY-MM-DD`), theo giờ VN |
| `gateCount` | number | Số lượt xe qua cổng (ANPR) trong ngày — đếm từng lượt, KHÔNG gộp |
| `meetingCount` | number | Số **phiên** có mặt phòng họp (đã gộp qua face-recognition), không phải số event thô |
| `zoneCount` | number | Số lượt xuất hiện/biến mất tại khu vực giám sát (camera zone); `0` là bình thường nếu chưa lắp camera zone |
| `events` | array | Danh sách sự kiện đã gộp từ 3 nguồn, sort tăng dần theo `time` |

### Giải thích từng field trong 1 `event`

| Field | Kiểu | Áp dụng cho | Giải thích |
|---|---|---|---|
| `time` | string (UTC ISO) | tất cả | Thời điểm sự kiện; với `meeting` là thời điểm **bắt đầu** phiên có mặt. FE tự convert sang giờ VN (+7h) để hiển thị |
| `type` | `'gate' \| 'meeting' \| 'zone'` | tất cả | Loại nguồn dữ liệu: `gate` = camera ANPR ở cổng, `meeting` = nhận diện khuôn mặt tại phòng họp, `zone` = camera giám sát khu vực |
| `direction` | string \| null | tất cả | `gate`: `enter`/`leave`; `zone`: `appear`/`disappear`; `meeting`: luôn là `'session'` (đã gộp phiên, không còn enter/leave lẻ) |
| `detail` | string | tất cả | Câu mô tả dựng sẵn bằng tiếng Việt ở BE, hiển thị trực tiếp trên UI (vd: "Xe 30G-699.46 vào Cổng chính") |
| `zoneName` | string \| null | `gate`, `zone` | Tên khu vực/cổng; `null` với `meeting` |
| `plateNumber` | string \| null | `gate` | Biển số xe; `null` với `meeting`/`zone` |
| `roomName` | string \| null | `meeting` | Tên phòng họp; `null` với `gate`/`zone` |
| `meetingId` | string \| null | `meeting` | ID cuộc họp liên quan (nếu resolve được) |
| `sourceEventId` | string \| null | `gate`, `meeting` (LUÔN `null` ở `zone`) | UUID của `iot_device_events` — dùng để lấy ảnh sự kiện qua `GET /ivss/device-events/:eventId/snapshot` (xem mục Auth/Permission phía trên). `gate`: có thể `null` nếu log cũ chưa từng gắn `event_id`. `meeting`: là `id` của event **đầu tiên** trong phiên gộp (đại diện cho cả phiên, không đổi khi phiên gộp thêm event). `zone` chưa hỗ trợ ảnh trong bản này — luôn `null`, không phải lỗi |
| `endTime` | string (UTC ISO) | chỉ `meeting` | Thời điểm kết thúc phiên có mặt (event cuối trong phiên gộp) |
| `durationMs` | number | chỉ `meeting` | Thời lượng phiên = `endTime - time` (ms); `0` nếu phiên chỉ có 1 event |
| `eventCount` | number | chỉ `meeting` | Số lần camera nhận diện khuôn mặt trong phiên đó — minh bạch mức độ gộp dữ liệu |

**Cơ chế gộp phiên (chỉ áp dụng cho `meeting`):** ngưỡng ngắt phiên lấy từ config
`campus.journey.gap_threshold_seconds` (mặc định 600s = 10 phút, key **riêng** của journey,
không dùng chung với `ivss.presence.gap_threshold_seconds` của báo cáo họp). Nếu người vẫn ở
cùng phòng và khoảng cách giữa 2 lần camera thấy mặt ≤ ngưỡng này thì tính là cùng 1 phiên
"có mặt". `gate` và `zone` giữ nguyên từng lượt rời rạc, không gộp.

---

## 2. GET `/api/v1/users` — API tìm kiếm nhân viên cho dropdown

Nguồn: [users.controller.ts](../src/modules/accounts/controllers/users.controller.ts) (method `listUsers`),
[user-list-item.dto.ts](../src/modules/accounts/dto/user-list-item.dto.ts),
[list-users-query.dto.ts](../src/modules/accounts/dto/list-users-query.dto.ts).
FE gọi qua `getUsers()` trong `businessAdminServices.js` (FE repo).

**Auth/Permission:** JWT + permission `accounts.user.list`.

**Mục đích:** autocomplete chọn nhân viên trong ô tìm kiếm (chỉ trả user đang `active`).

### Query params

| Field | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `search` | string | — | Tìm theo tên hoặc email |
| `page` | number | 1 | ≥ 1 |
| `limit` | number | 20 | 1–100 (FE truyền `limit: 15`) |

### Response mẫu

```json
{
  "success": true,
  "message": "Lấy danh sách người dùng thành công",
  "data": [
    {
      "id": "a1b2c3d4-...",
      "fullName": "Nguyễn Văn A",
      "email": "vana@company.com",
      "employeeCode": "EMP001"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 15,
    "total": 42,
    "totalPages": 3
  }
}
```

### Giải thích các trường

| Field | Kiểu | Giải thích |
|---|---|---|
| `data[].id` | string (UUID) | ID nhân viên — dùng làm `userId` khi gọi API journey ở mục 1 |
| `data[].fullName` | string | Họ tên hiển thị trong dropdown |
| `data[].email` | string | Email hiển thị phụ dưới tên trong dropdown |
| `data[].employeeCode` | string \| null | Mã nhân viên (có trong payload, không hiển thị trên UI trang này) |
| `meta.page` / `meta.limit` / `meta.total` / `meta.totalPages` | number | Thông tin phân trang chuẩn (trang UserJourney không dùng vì luôn lấy 15 kết quả đầu theo từ khoá gõ) |

---

## Luồng hoạt động trên FE

Người dùng gõ tên/email → debounce 300ms → gọi `GET /users?search=...&limit=15` để đổ dropdown
→ chọn 1 nhân viên + ngày → gọi `GET /campus/user-journey?userId=...&date=...` → render 3 thẻ KPI
(`gateCount`, `meetingCount`, `zoneCount`) và timeline dọc từ `events[]`, phân trang phía client
10 sự kiện/trang.
