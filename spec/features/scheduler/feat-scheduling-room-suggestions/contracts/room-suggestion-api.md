# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới contract cho UC-SM-01 (room-suggestion) | Toàn bộ file |

---

# API Contract: UC-SM-01 / UC-50 — Xem danh sách phòng họp đề xuất

> **Endpoint**: `GET /api/v1/scheduling/room-suggestions`
> **Module**: `scheduling`
> **Permission**: `scheduling.suggest.rooms`
> **System Roles**: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
> **Async**: No (đồng bộ)

## Request

### Path
`GET /api/v1/scheduling/room-suggestions`

### Query Parameters

| Parameter | Type | Required | Default | Description | Validation |
|---|---|---|---|---|---|
| `startTime` | string (ISO-8601) | Yes | — | Thời gian bắt đầu dự kiến | Phải có timezone, không được trong quá khứ |
| `endTime` | string (ISO-8601) | Yes | — | Thời gian kết thúc dự kiến | Phải có timezone, phải sau startTime, tối đa 24h |
| `attendeeCount` | integer | Yes | — | Số người tham gia dự kiến | >= 1 |
| `roomType` | string | No | — | Loại phòng: `meeting_room`, `board_room`, `training_room`, `open_space` | Nếu có, phải thuộc enum |
| `siteName` | string | No | — | Tên cơ sở/tòa nhà | Free text |
| `areaName` | string | No | — | Khu vực/tầng | Free text |
| `allowRecording` | boolean | No | — | Yêu cầu phòng cho phép recording | Nếu `true` → filter; nếu `false`/null → bỏ qua |
| `hasCamera` | boolean | No | — | Yêu cầu phòng có camera | Nếu `true` → filter EXISTS; nếu `false`/null → bỏ qua |
| `hasMicrophone` | boolean | No | — | Yêu cầu phòng có microphone | Nếu `true` → filter EXISTS; nếu `false`/null → bỏ qua |
| `hasDisplay` | boolean | No | — | Yêu cầu phòng có màn hình/máy chiếu | Nếu `true` → filter EXISTS; nếu `false`/null → bỏ qua |

### Example Request
```
GET /api/v1/scheduling/room-suggestions?startTime=2026-06-10T09:00:00%2B07:00&endTime=2026-06-10T11:00:00%2B07:00&attendeeCount=10&roomType=meeting_room&siteName=T%C3%B2a%20A&hasCamera=true&hasMicrophone=true
```

## Response

### 200 Success (có kết quả)

```json
{
  "success": true,
  "message": "Danh sách phòng họp đề xuất",
  "data": [
    {
      "roomId": "uuid",
      "roomCode": "R101",
      "roomName": "Phòng họp 101",
      "capacity": 12,
      "score": 83.33,
      "available": true,
      "matchedFeatures": ["camera", "microphone"],
      "warnings": ["Room does not have display"]
    }
  ],
  "meta": {
    "resultLimit": 20,
    "totalRoomsFound": 5
  }
}
```

### 200 Success (không có kết quả)

```json
{
  "success": true,
  "message": "Không tìm thấy phòng họp nào đáp ứng đủ các tiêu chí của bạn trong khung giờ này.",
  "data": [],
  "meta": {
    "resultLimit": 20,
    "totalRoomsFound": 0
  }
}
```

### Response Fields

| Field | Type | Description |
|---|---|---|
| `data[].roomId` | uuid | ID phòng |
| `data[].roomCode` | string | Mã phòng |
| `data[].roomName` | string | Tên phòng hiển thị |
| `data[].capacity` | integer | Sức chứa phòng |
| `data[].score` | number | Điểm phù hợp (0-100) |
| `data[].available` | boolean | Luôn `true` |
| `data[].matchedFeatures` | string[] | Danh sách thiết bị khả dụng đáp ứng yêu cầu |
| `data[].warnings` | string[] | Cảnh báo về thiết bị yêu cầu nhưng không có |
| `meta.resultLimit` | integer | Giới hạn kết quả tối đa (20) |
| `meta.totalRoomsFound` | integer | Tổng số phòng đáp ứng tiêu chí |

### Error Responses

#### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {
      "attendeeCount": ["attendeeCount must be a positive integer"]
    }
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/room-suggestions"
}
```

#### 401 Unauthorized

```json
{
  "success": false,
  "message": "Unauthorized",
  "error": {
    "code": "TOKEN_EXPIRED"
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/room-suggestions"
}
```

#### 403 Forbidden

```json
{
  "success": false,
  "message": "Forbidden",
  "error": {
    "code": "PERMISSION_DENIED"
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/room-suggestions"
}
```

#### 422 Validation Error

```json
{
  "success": false,
  "message": "Thời lượng tìm phòng không được vượt quá 24 giờ.",
  "error": {
    "code": "SCHEDULING_DURATION_TOO_LONG",
    "details": {}
  },
  "timestamp": "2026-06-16T10:00:00+07:00",
  "path": "/api/v1/scheduling/room-suggestions"
}
```

## Error Codes

| Code | HTTP | Description |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Input không hợp lệ (thiếu field, sai định dạng, attendeeCount <= 0, startTime trong quá khứ) |
| `SCHEDULING_DURATION_TOO_LONG` | 422 | Khoảng thời gian > 24h hoặc endTime <= startTime |
| `TOKEN_EXPIRED` | 401 | Token hết hạn hoặc không hợp lệ |
| `PERMISSION_DENIED` | 403 | Thiếu quyền `scheduling.suggest.rooms` |
