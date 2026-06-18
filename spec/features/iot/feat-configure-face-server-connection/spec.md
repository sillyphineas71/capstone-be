---
id: IOT-003
title: Cấu hình thông tin kết nối Face Server
module: iot
---

# Use Case: Cấu hình thông tin kết nối Face Server (IOT-003)

## 1. Tổng quan
Use case này cho phép người dùng cấu hình thông tin mạng và bảo mật cho thiết bị `door_face_terminal` (Face Server) để nó có thể giao tiếp và gửi callback events (heartbeat, verify, stranger) về backend.
Cấu hình này được lưu trữ trong `metadata_json` của bảng `iot_devices` và bao gồm việc tự động sinh một `callback_token` để xác thực Face Server.

## 2. Actors & Quyền (Permissions)
- **Actor:** Bất kỳ người dùng nào có permission `iot_devices:configure_face_server`.

## 3. API Contract

### Endpoint
`PATCH /api/v1/iot-devices/:id/face-server-config`

### Request Header
- `Authorization`: `Bearer <token>`

### Request Path Params
- `id`: UUID của thiết bị (`iot_devices.id`)

### Request Body (JSON)
```json
{
  "callback_enabled": true,
  "callback_protocol": "http",
  "callback_base_url": "http://192.168.2.10:3000",
  "heartbeat_path": "/api/v1/device-callbacks/face/heartbeat",
  "verify_path": "/api/v1/device-callbacks/face/verify",
  "stranger_path": "/api/v1/device-callbacks/face/stranger",
  "allowed_source_ip": "192.168.2.20"
}
```
*(Ghi chú: `callback_base_url` có thể là optional. `allowed_source_ip` bắt buộc đúng định dạng IP. Các path yêu cầu là chuỗi hợp lệ).*

### Response (200 OK)
Phản hồi trả về thông tin cấu hình thành công.
**Lưu ý:** Plain token chỉ được trả về duy nhất một lần ở field riêng `one_time_callback_token` để Admin copy vào thiết bị. Không đặt plain token bên trong `metadata_json`. Các API GET sau đó sẽ không trả về giá trị plain này.
```json
{
  "success": true,
  "message": "Face server configuration updated successfully",
  "data": {
    "id": "uuid",
    "device_type": "door_face_terminal",
    "metadata_json": {
      "face_server_config": {
        "callback_enabled": true,
        "callback_protocol": "http",
        "callback_base_url": "http://192.168.2.10:3000",
        "heartbeat_path": "/api/v1/device-callbacks/face/heartbeat",
        "verify_path": "/api/v1/device-callbacks/face/verify",
        "stranger_path": "/api/v1/device-callbacks/face/stranger",
        "allowed_source_ip": "192.168.2.20",
        "callback_token_last4": "ring",
        "configured_at": "2026-05-28T10:00:00.000Z"
      }
    },
    "one_time_callback_token": "random_plain_token_string"
  }
}
```

## 4. Business Rules & Logic

### 4.1 Validation & Ràng buộc (Constraints)
1. **Thiết bị tồn tại:** Trả lỗi 404 `NotFoundException` nếu ID thiết bị không có trong DB.
2. **Check Device Type:** Bắt buộc `device_type` phải là `door_face_terminal`. Trả 409 `ConflictException` (Code: `DEVICE_TYPE_NOT_FACE_SERVER`) nếu là thiết bị khác.
3. **Bắt buộc đã gán phòng:** `iot_devices.room_id` phải khác `null`. Nếu bằng null, trả 409 `ConflictException` (Code: `DEVICE_ROOM_ASSIGNMENT_REQUIRED`).
4. **Validation Payload DTO:** 
   - `callback_protocol`: Chỉ nhận `http` hoặc `https`.
   - `allowed_source_ip`: Phải đúng định dạng IP format.
   - `callback_base_url`: Optional, nhưng nếu truyền thì phải đúng định dạng URL.
   - `heartbeat_path`, `verify_path`, `stranger_path`: Phải là path hợp lệ (bắt đầu bằng `/`, không rỗng, và không chứa domain/full URL).

### 4.2 Xử lý Token và Lưu trữ (Storage)
Cập nhật cấu hình vào `iot_devices.metadata_json` tại node `face_server_config`. Không tạo bảng mới.
- **Sinh Token & Re-config behavior:** Mỗi lần gọi PATCH thành công, backend luôn tự động generate callback token mới. Token cũ sẽ bị thay thế bằng hash mới.
- **Lưu vào DB:** Database CHỈ lưu `callback_token_hash`, `callback_token_last4` (và `callback_token_generated_at` nếu cần). Tuyệt đối không lưu plain token.
- **Response & Logging Rule:** Không trả về `callback_token_hash` trong API response. Tuyệt đối không log plain token hoặc token hash.
- **Cấu trúc Json sẽ lưu trong DB:**
```json
{
  "face_server_config": {
    "callback_enabled": <value>,
    "callback_protocol": <value>,
    "callback_base_url": <value>,
    "heartbeat_path": <value>,
    "verify_path": <value>,
    "stranger_path": <value>,
    "allowed_source_ip": <value>,
    "callback_token_hash": "<hashed_string>",
    "callback_token_last4": "ring",
    "configured_at": "<current_timestamp>"
  }
}
```

### 4.3 Transaction & Audit Log
Sử dụng TypeORM QueryRunner / Transaction để bọc quá trình Update cấu hình thiết bị và Insert Audit Log thành một khối nguyên tử (atomic block).
- **Audit Log details:**
  - `user_id`: ID người thao tác.
  - `action_type`: `configure_face_server`.
  - `entity_type`: `iot_devices`.
  - `entity_id`: UUID thiết bị.
  - `metadata_json`: Chỉ lưu thông tin cấu hình không nhạy cảm (`allowed_source_ip`, `callback_base_url`, `heartbeat_path`, `verify_path`, `stranger_path`, `callback_token_last4`). Tuyệt đối **không** lưu `one_time_callback_token` và `callback_token_hash`.
  - `severity`: `info`.

## 5. Ngoài phạm vi (Out of Scope)
- Không implement logic nhận và xử lý callback (heartbeat, verify, stranger event).
- Không map user với person trên Face Server.
- Không cấu hình luồng Video/RTSP/IVSS.
- Không xử lý Attendance, Presence.
- Không phát sinh code cho API un-configure.
