# API Contract - Xem danh sach toan bo booking phong hien tai

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi API contract cho feature feat-list-room-bookings | Toan bo file |

---

> Base URL: /api/v1

---

## 1. List Room Bookings

### Request

GET /api/v1/room-bookings

### Headers

| Header | Value | Bat buoc |
|--------|-------|:--------:|
| Authorization | Bearer <jwt_token> | Co |

### Query Parameters

| Parameter | Type | Default | Mo ta | Validation |
|-----------|------|:-------:|-------|:----------:|
| page | integer | 1 | So trang | >= 1 |
| limit | integer | 20 | So item/trang | 1..100 |
| roomId | uuid | - | ID phong | UUID v4 |
| status | string | - | Trang thai booking | pending,approved,active,completed,cancelled,released |
| bookingType | string | - | Loai booking | scheduled,ad_hoc,extension,relocated |
| from | ISO 8601 | - | Thoi gian bat dau (reservedStartTime) | from <= to |
| to | ISO 8601 | - | Thoi gian ket thuc (reservedStartTime) | from <= to |
| q | string | - | Tim booking_code | case-insensitive, partial match |
| sortBy | string | reserved_start_time | Field sort | reserved_start_time,created_at,status |
| sortOrder | string | desc | Thu tu sort | asc, desc |

### Response: 200 OK

{
  "success": true,
  "message": "Danh sach dat phong",
  "data": [
    {
      "id": "uuid",
      "bookingCode": "BK-2026-001",
      "bookingType": "scheduled",
      "status": "approved",
      "roomId": "uuid",
      "meetingId": "uuid",
      "bookedBy": "uuid",
      "reservedStartTime": "2026-07-25T09:00:00.000Z",
      "reservedEndTime": "2026-07-25T10:00:00.000Z",
      "approvedBy": "uuid",
      "approvedAt": "2026-07-24T10:00:00.000Z",
      "cancellationReason": null,
      "createdAt": "2026-07-23T10:00:00.000Z",
      "updatedAt": "2026-07-24T10:00:00.000Z",
      "room": { "id": "uuid", "roomName": "Phong 101" },
      "meeting": { "id": "uuid", "title": "Hop Sprint Planning" },
      "bookedByUser": { "id": "uuid", "fullName": "Nguyen Van A", "email": "nva@company.com" },
      "approvedByUser": { "id": "uuid", "fullName": "Tran Van B", "email": "tvb@company.com" }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
}

### Response: 200 OK (empty)

{
  "success": true,
  "message": "Danh sach dat phong",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}

## 2. Error Responses

### 400 Bad Request

{
  "success": false,
  "message": "Validation error",
  "error": { "code": "VALIDATION_ERROR" }
}

### 401 Unauthorized

{
  "success": false,
  "message": "Vui long dang nhap",
  "error": { "code": "UNAUTHORIZED" }
}

### 403 Forbidden

{
  "success": false,
  "message": "Khong co quyen",
  "error": { "code": "FORBIDDEN", "details": { "requiredPermission": "room.booking.read" } }
}

### 422 Unprocessable Entity

{
  "success": false,
  "message": "Invalid enum value",
  "error": { "code": "VALIDATION_ERROR", "details": { "reason": "invalid_enum" } }
}

### 500 Internal Server Error

{
  "success": false,
  "message": "Loi he thong",
  "error": { "code": "INTERNAL_ERROR" }
}

## 3. Status Code Summary

| Status | Mo ta |
|:------:|-------|
| 200 | Thanh cong |
| 400 | Validation error |
| 401 | Unauthenticated |
| 403 | Forbidden |
| 422 | Invalid enum / sort field |
| 500 | Internal error |

