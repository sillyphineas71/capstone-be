# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Khởi tạo spec.md cho IOT-006: Nhận heartbeat từ Face Server | Toàn bộ file |
| 2026-06-02 | Hỗ trợ cả GET và POST cho heartbeat endpoint (tương thích phần cứng thật không chọn được HTTP method) | Mục 3, 4.1, 4.2, 6 |
| 2026-06-02 | Hỗ trợ short URL alias (`/api/v1/hb`), short query params (`d`, `t`) và cập nhật token length guideline do giới hạn URL của thiết bị thật ("News Letter Exceed!") | Mục 3, 4.1, 4.2, 4.3, 4.8, 6 |
| 2026-06-02 | Làm rõ cấu trúc 2 controllers (`DeviceCallbacksController` và `ShortDeviceCallbacksController`) và chuẩn hóa đánh số Acceptance Criteria | Mục 4.1, 6 |
| 2026-06-02 | Hỗ trợ thêm endpoint path-param (`/api/v1/hb/:deviceCode/:callbackToken`) do Face Server cắt URL sau dấu `&` | Mục 3, 4.1, 4.2, 4.3, 6 |

# IOT-006: Nhận heartbeat từ Face Server (Door Face Attendance Terminal)

## 1. Mục tiêu (Objective)
Thiết kế endpoint để backend NestJS nhận HTTP heartbeat callback định kỳ (mỗi 30 giây) từ Face Server / Door Face Attendance Terminal thật. Khi nhận heartbeat hợp lệ, backend cập nhật `last_seen_at`, `status`, `health_status` và `metadata_json.last_heartbeat` cho thiết bị tương ứng trong bảng `iot_devices`.

UC này phục vụ trực tiếp cho IOT-005 (Check Camera Availability): IOT-005 dựa vào `last_seen_at` để xác định Face Server còn online hay không.

## 2. Phạm vi (Scope)

### 2.1. Trong phạm vi
- Nhận HTTP heartbeat callback (GET hoặc POST) từ Face Server thật hoặc Postman/curl giả lập.
- Xác thực thiết bị qua `device_code` và `callback_token` (SHA-256 hash comparison).
- Kiểm tra `allowed_source_ip` theo best-effort.
- Cập nhật trạng thái thiết bị trong DB.
- Lưu `metadata_json.last_heartbeat` bao gồm raw payload sample đã mask sensitive fields.

### 2.2. Ngoài phạm vi
- Không xử lý verify event (nhận diện khuôn mặt).
- Không xử lý stranger event.
- Không tạo attendance record.
- Không detect no-show.
- Không start/stop recording.
- Không xử lý face recognition trong backend.
- Không dùng MQTT/Mosquitto.
- Không dùng IVSS.
- Không dùng Center Connection.
- Không tạo bảng mới.
- Không ghi audit log (heartbeat gọi mỗi 30 giây, audit sẽ gây database bloat).
- Không dùng JWT/permission guard (đây là device callback, không phải Admin API).

## 3. Thông tin thiết bị thật (Hardware Reference)

| Thuộc tính | Giá trị |
| :--- | :--- |
| IP | 192.168.2.3 |
| Title | Face1 |
| Device ID | 1792832 |
| MAC | 5c:f2:86:88:7a:df |
| Software version | v8.52.9.2-1095.1.1 |
| HeartBeat interval | 30 giây |
| Backend IP (laptop) | 192.168.2.2 |
| Backend port | 3000 |

**Giới hạn phần cứng:** Face Server thật chỉ cho cấu hình URL dạng `Service Address + Service Port + HeartBeat URL`. Không thấy hỗ trợ custom HTTP header, custom JSON body, hay lựa chọn HTTP method. Hơn nữa, **trường HeartBeat URL bị giới hạn độ dài** (báo lỗi "News Letter Exceed!" nếu quá dài). Đặc biệt, khi lưu URL chứa nhiều query param bằng dấu `&`, thiết bị sẽ tự động cắt bỏ phần sau dấu `&` (ví dụ `/api/v1/hb?d=123&t=abc` chỉ còn `/api/v1/hb?d=123`).
Do đó, kịch bản khả thi nhất là truyền qua **path parameter** trên short HeartBeat URL (`/api/v1/hb/:deviceCode/:callbackToken`), và HTTP method mà thiết bị gửi có thể là GET hoặc POST (không xác định trước).

**Cấu hình dự kiến trên thiết bị:**
- Service Address: `192.168.2.2`
- Service Port: `3000`
- HeartBeat URL: `/api/v1/hb/TEST-CAM-001/<short_token>` (hoặc `/api/v1/hb/1792832/<short_token>` nếu `1792832` được map làm `device_code`)
- HeartBeat interval: `30`

## 4. Yêu cầu kỹ thuật (Technical Requirements)

### 4.1. Endpoint Design
- **Method & Route**:
  - Primary (Canonical): `POST /api/v1/device-callbacks/face/heartbeat`
  - Canonical GET Compatibility: `GET /api/v1/device-callbacks/face/heartbeat`
  - Hardware Alias (Short Query URL): `GET/POST /api/v1/hb`
  - **Hardware Alias (Path-param URL)**: `GET/POST /api/v1/hb/:deviceCode/:callbackToken`
  - Lý do: Web UI của Face Server thật cắt URL sau dấu `&`. Cần cung cấp endpoint path-param để phần cứng sử dụng. Tất cả endpoint đều trỏ tới cùng một logic.
  - Implementation: Cả hai method gọi chung một service method (`IotDevicesService.receiveHeartbeat(...)`), không duplicate logic.
- **Controller**: Cần tạo 2 controller riêng biệt trong module `iot`, tách khỏi `iot-devices.controller.ts` (tránh đụng Admin API JWT guard):
  - `DeviceCallbacksController`:
    - Route prefix: `device-callbacks`
    - Support: `GET /api/v1/device-callbacks/face/heartbeat`, `POST /api/v1/device-callbacks/face/heartbeat`
  - `ShortDeviceCallbacksController` (hoặc cấu trúc alias tương đương):
    - Route prefix: `hb`
    - Support: `GET /api/v1/hb`, `POST /api/v1/hb`, `GET /api/v1/hb/:deviceCode/:callbackToken`, `POST /api/v1/hb/:deviceCode/:callbackToken`
- **Guard**: Không dùng `JwtAuthGuard`. Không dùng `PermissionsGuard`. Endpoint này mở cho device callback.
- **Request Body**:
  - Với POST: Chấp nhận JSON body bất kỳ (tolerant payload). Không strict DTO. Nếu body rỗng vẫn hợp lệ khi `device_code` và `callback_token` có mặt qua header hoặc query.
  - Với GET: Không mong đợi body. Chỉ extract `device_code` và `callback_token` từ header hoặc query param.

### 4.2. Extract `device_code` (Thứ tự ưu tiên)
1. Header: `X-Device-Code`
2. Body JSON: `device_code` (chỉ khả dụng với POST có body)
3. Query param: `device_code`
4. Query param: `d`
5. Path param: `deviceCode`

Nếu không tìm thấy ở bất kỳ nguồn nào → trả `400 Bad Request`, error code `DEVICE_CODE_REQUIRED`.

### 4.3. Extract `callback_token` (Thứ tự ưu tiên)
1. Header: `X-Callback-Token`
2. Body JSON: `callback_token` (chỉ khả dụng với POST có body)
3. Query param: `callback_token`
4. Query param: `t`
5. Path param: `callbackToken`

Nếu không tìm thấy ở bất kỳ nguồn nào → trả `401 Unauthorized`, error code `CALLBACK_TOKEN_REQUIRED`.

### 4.4. Thứ tự Validation (5A)
1. Extract `device_code` → nếu thiếu: `400 DEVICE_CODE_REQUIRED`.
2. Tìm device trong DB theo `device_code` → nếu không thấy: `404 IOT_DEVICE_NOT_FOUND`.
3. Kiểm tra `device.device_type === 'door_face_terminal'` → nếu sai: `409 DEVICE_TYPE_NOT_FACE_SERVER`.
4. Kiểm tra `metadata_json.face_server_config.callback_enabled === true` → nếu false hoặc không tồn tại: `409 FACE_CALLBACK_NOT_ENABLED`.
5. Extract `callback_token` → nếu thiếu: `401 CALLBACK_TOKEN_REQUIRED`.
6. Hash token nhận được bằng SHA-256 và so sánh với `metadata_json.face_server_config.callback_token_hash` → nếu không khớp: `401 INVALID_CALLBACK_TOKEN`.
7. Kiểm tra `allowed_source_ip` (best-effort, xem mục 4.5).
8. Process heartbeat (xem mục 4.6).

### 4.5. Allowed Source IP Check (Best-Effort)
- Nếu `metadata_json.face_server_config.allowed_source_ip` có giá trị:
  - Lấy client IP từ request (cần normalize `::ffff:` prefix cho IPv4-mapped IPv6).
  - So sánh IP client với `allowed_source_ip`.
  - Nếu không khớp **và** IP client xác định rõ ràng: trả `403 Forbidden`, error code `SOURCE_IP_NOT_ALLOWED`.
  - Nếu IP client không xác định chắc chắn (ví dụ: qua reverse proxy, Docker, `::1`): **skip check**, ghi warning log thay vì block.
- Nếu `allowed_source_ip` không có giá trị (null/undefined/empty): **skip check hoàn toàn**.
- Mục tiêu: không được block local testing khi chưa cấu hình `allowed_source_ip`.

### 4.6. Business Logic — Process Heartbeat
Khi tất cả validation pass:

**Cập nhật `iot_devices`:**
- `last_seen_at = NOW()`
- `status = 'online'`
- `health_status = 'healthy'`
- `updated_at = NOW()` (TypeORM `@UpdateDateColumn` tự xử lý)

**Cập nhật `metadata_json.last_heartbeat` (merge object):**
```json
{
  "last_heartbeat": {
    "received_at": "2026-06-02T01:10:00.000Z",
    "source_ip": "192.168.2.3",
    "payload_timestamp": "<body.timestamp nếu có>",
    "device_status": "<body.status nếu có>",
    "raw_payload_sample": {
      "status": "alive",
      "firmware_version": "v8.52.9.2"
    }
  }
}
```

**Quy tắc merge metadata:**
- Dùng object spread `{ ...currentMetadata, last_heartbeat: { ... } }`.
- Tuyệt đối không xóa các key metadata đã có:
  - `face_server_config`
  - `rtsp_config`
  - `last_availability_check`
  - `vendor`
  - `connection`
  - bất kỳ metadata khác.

**Quy tắc `raw_payload_sample`:**
- Lưu một bản sao shallow của request body (hoặc `{}` nếu body rỗng).
- Trước khi lưu, chạy qua `maskSensitiveMetadata()` để xóa/mask mọi key chứa `secret`, `token`, `password`.
- Tuyệt đối không lưu plain `callback_token` vào DB.

### 4.7. Database Transaction
- Dùng `EntityManager` hoặc `QueryRunner` theo convention hiện có trong codebase.
- Nếu save lỗi, trả HTTP `500` và không trả response success giả.
- Không tạo bảng mới.
- Không ghi `audit_logs`.
- Không rate-limit trong MVP.

### 4.8. Token Length & Compatibility (Ghi chú cho IOT-003)
- Token plain sinh ra cho Face Server (UC IOT-003) nên được dùng dạng ngắn (short token) để tránh lỗi độ dài URL, ví dụ: `crypto.randomBytes(16).toString('base64url')` (khoảng 22 ký tự).
- Cấu trúc DB **không thay đổi**: DB vẫn chỉ lưu `callback_token_hash` được băm bằng SHA-256 từ plain token ngắn này.
- **Bảo mật**: Không lưu plain token vào DB, không log plain token. Không log full request URL khi có error/debug vì query params chứa plain token.
- Nếu thiết bị nào đang dùng token quá dài (gây lỗi "News Letter Exceed!"), user/admin cần cấu hình lại (re-config) để sinh token ngắn mới.

## 5. Response Contract

### 5.1. Success Response (HTTP 200)
```json
{
  "success": true,
  "message": "Heartbeat received successfully",
  "data": {
    "device_code": "TEST-CAM-001",
    "status": "online",
    "health_status": "healthy",
    "last_seen_at": "2026-06-02T01:10:00.000Z",
    "received_at": "2026-06-02T01:10:00.000Z"
  }
}
```

### 5.2. Error Responses

| Tình huống | HTTP Status | Error Code |
| :--- | :---: | :--- |
| Thiếu `device_code` | 400 | `DEVICE_CODE_REQUIRED` |
| Device không tồn tại | 404 | `IOT_DEVICE_NOT_FOUND` |
| Device type không phải `door_face_terminal` | 409 | `DEVICE_TYPE_NOT_FACE_SERVER` |
| Callback chưa enable hoặc chưa config | 409 | `FACE_CALLBACK_NOT_ENABLED` |
| Thiếu `callback_token` | 401 | `CALLBACK_TOKEN_REQUIRED` |
| Token không hợp lệ | 401 | `INVALID_CALLBACK_TOKEN` |
| Source IP không khớp `allowed_source_ip` | 403 | `SOURCE_IP_NOT_ALLOWED` |

### 5.3. Security — Response không được chứa
- `callback_token`
- `callback_token_hash`
- `callback_token_last4`
- `rtsp_password`
- `rtsp_password_encrypted`
- Bất kỳ secret/token/password nào từ `metadata_json`.

## 6. Acceptance Criteria

### Functional
1. Nhận heartbeat thành công qua **GET /api/v1/hb/:deviceCode/:callbackToken** (kịch bản phần cứng thật mới nhất).
2. Nhận heartbeat thành công qua **POST /api/v1/hb/:deviceCode/:callbackToken**.
3. Nhận heartbeat thành công qua **GET/POST /api/v1/hb** với short query param `d` + `t`.
4. Endpoint canonical cũ (`/api/v1/device-callbacks/face/heartbeat`) vẫn hoạt động với cả `GET` và `POST`.
5. Token ngắn vẫn được hash (SHA-256) và verify đúng với `callback_token_hash` trong DB.
6. Nhận heartbeat thành công qua header `X-Device-Code` + `X-Callback-Token` (kịch bản Postman giả lập).
7. Nhận heartbeat thành công khi `device_code` nằm trong body JSON (POST).
8. Các endpoint (canonical và alias) đều chia sẻ logic: cập nhật `last_seen_at`, `status = 'online'`, `health_status = 'healthy'`.
9. `metadata_json.last_heartbeat` được cập nhật với `received_at`, `source_ip`, `raw_payload_sample`.
10. Metadata cũ (`face_server_config`, `rtsp_config`, `last_availability_check`, v.v.) không bị xóa.

### Validation & Error
11. Missing `device_code` → `400 DEVICE_CODE_REQUIRED`.
12. Device không tồn tại → `404 IOT_DEVICE_NOT_FOUND`.
13. Device type không phải `door_face_terminal` → `409 DEVICE_TYPE_NOT_FACE_SERVER`.
14. Callback chưa enable → `409 FACE_CALLBACK_NOT_ENABLED`.
15. Missing `callback_token` → `401 CALLBACK_TOKEN_REQUIRED`.
16. Invalid `callback_token` → `401 INVALID_CALLBACK_TOKEN`.
17. Source IP không khớp (khi check xác định được) → `403 SOURCE_IP_NOT_ALLOWED`.

### Security
18. `raw_payload_sample` không chứa plain `callback_token`, `password`, `secret`.
19. Response không lộ `callback_token`, `callback_token_hash`, `rtsp_password`, hoặc bất kỳ secret nào.
20. Không log plain `callback_token` (đặc biệt: không log full request URL vì token nằm trong query param).

### Scope Guard
21. Không tạo attendance record.
22. Không detect no-show.
23. Không start/stop recording.
24. Không ghi audit log.
25. Không xử lý verify/stranger event.
26. Không dùng MQTT.
