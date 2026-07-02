# API Contract - Xem danh sách biên bản họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo contract cho feat-list-meeting-minutes | Toàn bộ file |
| 2026-07-02 | Bỏ mã lỗi 422, gộp vào 400 (ValidationPipe mặc định của dự án không phân biệt 422) | Mục 2, Mục 3 |

> Base URL: /api/v1

---

## 1. List Meeting Minutes

### Request

```
GET /api/v1/meeting-minutes
```

### Headers

| Header | Value | Bắt buộc |
|--------|-------|:--------:|
| Authorization | Bearer <jwt_token> | Có |

### Query Parameters

| Parameter | Type | Default | Mô tả | Validation |
|-----------|------|:-------:|-------|:----------:|
| page | integer | 1 | Số trang | >= 1 |
| limit | integer | 20 | Số item/trang | 1..20 (BR2 — khác convention chung 100) |
| status | string | - (mọi status trong scope) | Trạng thái biên bản | draft,published,archived,all |
| roomId | uuid | - | ID phòng họp | UUID v4 |
| from | ISO 8601 | - | Thời gian bắt đầu (meeting.actual_start_time) | from <= to |
| to | ISO 8601 | - | Thời gian kết thúc (meeting.actual_start_time) | from <= to |
| q | string | - | Tìm theo minutes.title / meeting.title / host.fullName | case-insensitive, partial match |
| sortBy | string | actual_start_time | Field sort | actual_start_time, created_at |
| sortOrder | string | desc | Thứ tự sort | asc, desc |

### Response: 200 OK

```json
{
  "success": true,
  "message": "Danh sách biên bản họp",
  "data": [
    {
      "id": "uuid",
      "title": "Bien ban hop: Sprint Planning",
      "status": "published",
      "versionNo": 1,
      "createdAt": "2026-06-30T09:30:00.000Z",
      "meeting": {
        "id": "uuid",
        "title": "Sprint Planning",
        "actualStartTime": "2026-06-30T09:00:00.000Z",
        "actualEndTime": "2026-06-30T10:00:00.000Z",
        "meetingMode": "offline",
        "room": { "id": "uuid", "roomName": "Phong 101" }
      },
      "host": { "id": "uuid", "fullName": "Nguyen Van A", "email": "nva@company.com" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 35, "totalPages": 2 }
}
```

### Response: 200 OK (meeting online, không có phòng)

```json
{
  "success": true,
  "message": "Danh sách biên bản họp",
  "data": [
    {
      "id": "uuid",
      "title": "Bien ban hop: Weekly Sync",
      "status": "draft",
      "versionNo": 1,
      "createdAt": "2026-07-01T08:00:00.000Z",
      "meeting": {
        "id": "uuid",
        "title": "Weekly Sync",
        "actualStartTime": "2026-07-01T07:30:00.000Z",
        "actualEndTime": null,
        "meetingMode": "online",
        "room": null
      },
      "host": { "id": "uuid", "fullName": "Tran Thi B", "email": "ttb@company.com" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### Response: 200 OK (empty — không có biên bản trong scope)

```json
{
  "success": true,
  "message": "Danh sách biên bản họp",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

## 2. Error Responses

### 400 Bad Request

```json
{
  "success": false,
  "message": "Validation error",
  "error": { "code": "VALIDATION_ERROR" }
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Vui lòng đăng nhập",
  "error": { "code": "UNAUTHORIZED" }
}
```

### 403 Forbidden

```json
{
  "success": false,
  "message": "Không có quyền",
  "error": { "code": "FORBIDDEN", "details": { "requiredPermission": "meeting.minutes.read" } }
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Lỗi hệ thống",
  "error": { "code": "INTERNAL_ERROR" }
}
```

## 3. Status Code Summary

| Status | Mô tả |
|:------:|-------|
| 200 | Thành công (kể cả danh sách rỗng) |
| 400 | Validation error (page/limit/UUID/date range/enum status/sortBy — dùng ValidationPipe mặc định của dự án, không phân biệt 422) |
| 401 | Unauthenticated |
| 403 | Forbidden (thiếu permission meeting.minutes.read) |
| 500 | Internal error |
