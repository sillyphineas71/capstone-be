---
name: feat-receive-face-server-verify-event
description: Specification for receiving, validating, and recording verify events from Face Server (IOT-007)
category: iot
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Khởi tạo Spec cho IOT-007 (Nhận verify event từ Face Server theo hướng thăm dò telemetry) | Toàn bộ file |

# IOT-007: Nhận verify event từ Face Server

## 1. Giới thiệu (Introduction)

**Mục tiêu:** 
Xây dựng endpoint để nhận callback event xác thực (Verify Event) từ các thiết bị nhận diện khuôn mặt (Face Server). Mục đích chính của Use Case này là **Telemetry / Payload Discovery**. Hệ thống chỉ chịu trách nhiệm nhận callback, xác thực request an toàn, cập nhật trạng thái sống (online/healthy) của thiết bị, và lưu mẫu (sample) của payload thô vào cơ sở dữ liệu để phục vụ việc phân tích format thực tế của nhà sản xuất OEM.

**Out of scope (Ngoài phạm vi UC này):**
- Không tạo `attendance_records` hay `check-in/out event`.
- Không tạo `presence_snapshots`.
- Không map user với person_id của thiết bị.
- Không chuẩn hóa sự kiện thành business event.
- Không xử lý stranger event (người lạ).
- Không phát hiện no-show.
- Không ghi file ảnh/media vào storage.
- Không tạo bảng mới trong database.
- Không ghi audit log.
- Không dùng MQTT/Mosquitto/IVSS/Center Connection.

## 2. Bối cảnh hệ thống (System Context)

- **Framework:** NestJS, TypeORM, PostgreSQL.
- **Module:** `iot`.
- **Entity/Bảng liên quan:** `iot_devices`.
- **Device Type áp dụng:** `door_face_terminal`.
- **Cấu hình trên Face Server thật (Dự kiến):**
  - Protocol Type: `LAN`
  - Service Address: `192.168.2.2`
  - Service Port: `3000`
  - Verify Subscription: `Verify without Pic` (Lựa chọn ưu tiên để payload nhẹ, ít tốn tài nguyên. Nếu thiết bị không gửi, fallback xuống `Verify with Reg`, `Verify(Reg + Snap)`, hoặc `Verify with Snap`).
  - Verify URL: `/api/v1/vf/TEST-CAM-001/<short_token>` (sử dụng path params do giới hạn thiết bị).

## 3. Kiến trúc Endpoints

Endpoint là **Device Callback API**, không yêu cầu đăng nhập (`JwtAuthGuard`), không check quyền (`PermissionsGuard`). Xác thực dựa vào `callback_token` được hash trước đó (setup ở IOT-003).

- **Canonical Endpoints (Controller: `DeviceCallbacksController`)**:
  - `GET /api/v1/device-callbacks/face/verify`
  - `POST /api/v1/device-callbacks/face/verify`
- **Hardware Alias Endpoints (Controller: `ShortDeviceCallbacksController` hoặc Alias Controller)**:
  - `GET /api/v1/vf/:deviceCode/:callbackToken`
  - `POST /api/v1/vf/:deviceCode/:callbackToken`

**Lý do dùng short path-param URL:** Web UI của Face Server bị giới hạn chặt độ dài URL và có nguy cơ cắt mất các query parameters sau ký tự `&`. Do đó, truyền trực tiếp params qua đường dẫn sẽ an toàn và tương thích với 100% phần cứng.

Tất cả các route trên đều gọi chung một method trong Service, tránh việc lặp lại business logic.

## 4. Xử lý Logic và Bảo mật (Validation Flow)

### 4.1. Trích xuất `device_code` (Theo thứ tự ưu tiên)
1. Header: `X-Device-Code`
2. Body JSON: `device_code`
3. Query param: `device_code`
4. Query param: `d`
5. Path param: `deviceCode`

*(Lỗi nếu thiếu: `400 Bad Request` - `DEVICE_CODE_REQUIRED`)*

### 4.2. Trích xuất `callback_token` (Theo thứ tự ưu tiên)
1. Header: `X-Callback-Token`
2. Body JSON: `callback_token`
3. Query param: `callback_token`
4. Query param: `t`
5. Path param: `callbackToken`

*(Lỗi nếu thiếu: `401 Unauthorized` - `CALLBACK_TOKEN_REQUIRED`)*

### 4.3. Xác thực Thiết bị & IP
- **Device Match:** Truy vấn `iot_devices` theo `device_code`. 
  *(Lỗi nếu sai: `404 Not Found` - `IOT_DEVICE_NOT_FOUND`)*
- **Type Check:** Đảm bảo `device_type === 'door_face_terminal'`.
  *(Lỗi nếu sai: `409 Conflict` - `DEVICE_TYPE_NOT_FACE_SERVER`)*
- **Enable Check:** `metadata_json.face_server_config.callback_enabled` phải là `true`.
  *(Lỗi nếu sai: `409 Conflict` - `FACE_CALLBACK_NOT_ENABLED`)*
- **Token Verify:** Hash token nhận được (SHA-256) và đối chiếu với `callback_token_hash`.
  *(Lỗi nếu sai: `401 Unauthorized` - `INVALID_CALLBACK_TOKEN`)*
- **Source IP Filter:** Kiểm tra IP client hiện tại với `allowed_source_ip` (best-effort, giống IOT-006).

### 4.4. Xử lý Payload (Tolerant Ingestion)
Backend cần linh hoạt (tolerant) do thiết bị OEM có thể gửi dữ liệu dị biệt.
- **Support format:** JSON, form-data, multipart/form-data, text/raw body, hoặc body rỗng.
- **Multipart/form-data rules:**
  - Nếu payload là ảnh, KHÔNG LƯU binary buffer hay base64 image vào `metadata_json` (tránh phình DB).
  - Phân tích và lưu các text fields thông thường.
  - Với file ảnh, chỉ lưu metadata (ví dụ: `field_name`, `original_name`, `mimetype`, `size`).
- **Unparseable payload:** Nếu payload không thể parse, **không crash server**. Lưu thông tin tối thiểu: `content_type`, `content_length`, `method`, `source_ip`, `received_at`.
- Mọi object sample trước khi lưu đều phải qua bộ lọc `maskSensitiveMetadata()`.

## 5. Lưu trữ DB (Business Logic)

Khi Event hợp lệ:
1. Cập nhật `last_seen_at` = thời gian hiện tại.
2. Cập nhật `status` = `'online'`.
3. Cập nhật `health_status` = `'healthy'`.
4. Merge object `metadata_json` (KHÔNG XÓA các key cũ như `face_server_config`, `rtsp_config`, `last_heartbeat`...):
   - Lưu **`last_verify_event_sample`**: chứa mẫu event mới nhất.
   - Lưu **`recent_verify_event_samples`**: là mảng chứa tối đa **5 event gần nhất**.
   - Truncate text fields lớn, nếu bị cắt thì ghi thêm flag `truncated: true`.

Cấu trúc metadata mẫu:
```json
{
  "received_at": "2026-06-02T10:00:00Z",
  "source_ip": "192.168.2.3",
  "raw_payload_sample": {},
  "extracted_fields": {
    "person_id": "...",
    "person_name": "...",
    "verify_time": "...",
    "verify_result": "...",
    "similarity": "..."
  }
}
```

## 6. Response Contract

Không trả về plain token, mật khẩu, hay hash.
```json
{
  "success": true,
  "message": "Verify event received successfully",
  "data": {
    "device_code": "TEST-CAM-001",
    "event_type": "face_verify",
    "received_at": "2026-06-02T10:00:00.000Z"
  }
}
```

## 7. Logging & Security constraints
- Không log full URL vì callback token có thể nằm ở path params.
- Không log plain callback token ra màn hình/file.
- Không lưu plain callback token xuống DB.
- Không log các khối data binary/ảnh thô ra màn hình terminal.

## 8. Acceptance Criteria (Tiêu chí nghiệm thu)

1. Nhận verify event thành công qua short alias `GET /api/v1/vf/:deviceCode/:callbackToken`.
2. Nhận verify event thành công qua short alias `POST /api/v1/vf/:deviceCode/:callbackToken`.
3. Nhận verify event thành công qua canonical `GET/POST`.
4. Nhận verify event thành công qua header `X-Device-Code` + `X-Callback-Token`.
5. Nhận verify event thành công khi `device_code` / `callback_token` nằm trong body JSON.
6. Body rỗng không làm server crash nếu path/header/query đã đủ thông tin xác thực.
7. Multipart/form-data hoặc form-data không làm server crash.
8. Trả lỗi `400 DEVICE_CODE_REQUIRED` nếu thiếu device_code.
9. Trả lỗi `404 IOT_DEVICE_NOT_FOUND` nếu thiết bị không tồn tại.
10. Trả lỗi `409 DEVICE_TYPE_NOT_FACE_SERVER` nếu type không phải `door_face_terminal`.
11. Trả lỗi `409 FACE_CALLBACK_NOT_ENABLED` nếu chưa enable.
12. Trả lỗi `401 CALLBACK_TOKEN_REQUIRED` nếu thiếu callback_token.
13. Trả lỗi `401 INVALID_CALLBACK_TOKEN` nếu token sai.
14. Trả lỗi `403 SOURCE_IP_NOT_ALLOWED` nếu cấu hình chặn IP.
15. Event hợp lệ update được `last_seen_at`, `status`, `health_status`.
16. `metadata_json.last_verify_event_sample` được cập nhật an toàn.
17. `metadata_json.recent_verify_event_samples` giữ mảng tối đa 5 log gần nhất.
18. Metadata cũ của các UC trước không bị xóa bỏ hoặc hỏng.
19. Mẫu payload không chứa thông tin secret/password (đã mask) và không lưu ảnh base64/binary thô.
20. Response không làm lộ token hay hash.
21. KHÔNG tạo `attendance_records` hay `presence_snapshots`, KHÔNG ghi audit log.
