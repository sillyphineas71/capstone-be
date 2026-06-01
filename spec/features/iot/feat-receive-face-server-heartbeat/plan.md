# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Khởi tạo plan.md cho IOT-006 | Toàn bộ file |
| 2026-06-02 | Cập nhật plan.md để hỗ trợ short URL alias (`/api/v1/hb`) và short query params (`d`, `t`) do giới hạn độ dài HeartBeat URL của thiết bị thật | Toàn bộ file |

# Kế hoạch triển khai IOT-006: Nhận heartbeat từ Face Server

## 1. Module & controllers
- UC này nằm trong module `iot`.
- Cần tạo 2 controller riêng biệt để xử lý device callback, không dùng chung với `iot-devices.controller.ts` để tránh đụng độ `JwtAuthGuard` của Admin API.
- **Tạo controller canonical:**
  - Tên: `DeviceCallbacksController`
  - Route prefix: `device-callbacks`
  - Support:
    - `GET /api/v1/device-callbacks/face/heartbeat`
    - `POST /api/v1/device-callbacks/face/heartbeat`
- **Tạo short alias controller:**
  - Tên: `ShortDeviceCallbacksController`
  - Route prefix: `hb`
  - Support:
    - `GET /api/v1/hb`
    - `POST /api/v1/hb`
- **Implementation:** Cả canonical endpoint và short alias endpoint đều nhận request context và gọi chung một service method `IotDevicesService.receiveHeartbeat(...)`. Không duplicate business logic.
- Không gắn `JwtAuthGuard`.
- Không gắn `PermissionsGuard`.

## 2. Hardware compatibility
- Face Server thật chỉ cấu hình được:
  - Service Address
  - Service Port
  - HeartBeat URL
- Trường `HeartBeat URL` bị giới hạn độ dài nghiêm ngặt, thiết bị thật đã báo lỗi `"News Letter Exceed!"` khi dùng URL dài.
- Do đó, kịch bản test trên camera thật bắt buộc phải dùng short URL:
  - Service Address: `192.168.2.2`
  - Service Port: `3000`
  - HeartBeat URL: `/api/v1/hb?d=TEST-CAM-001&t=<short_token>`
  - HeartBeat interval: `30`
- Controller và service không được phụ thuộc vào JSON body, vì camera thật có thể gửi GET hoặc POST với body rỗng.

## 3. Extract `device_code`
Thứ tự ưu tiên để trích xuất `device_code`:
1. Header `X-Device-Code` (Node/Express đọc là `x-device-code`)
2. Body JSON `device_code`
3. Query param `device_code`
4. Query param `d` (Short alias cho thiết bị thật)

- Nếu giá trị nhận được là array (do truyền nhiều query cùng tên), lấy phần tử đầu tiên.
- Thực hiện `trim()` string value.
- Nếu thiếu hoặc rỗng sau khi trim: ném lỗi `400 BadRequestException` với code `DEVICE_CODE_REQUIRED`.

## 4. Extract `callback_token`
Thứ tự ưu tiên để trích xuất `callback_token`:
1. Header `X-Callback-Token` (Node/Express đọc là `x-callback-token`)
2. Body JSON `callback_token`
3. Query param `callback_token`
4. Query param `t` (Short alias cho thiết bị thật)

- Nếu giá trị nhận được là array, lấy phần tử đầu tiên.
- Thực hiện `trim()` string value.
- Nếu thiếu hoặc rỗng sau khi trim: ném lỗi `401 UnauthorizedException` với code `CALLBACK_TOKEN_REQUIRED`.
- **Bảo mật:** Không log plain token. Tuyệt đối không log full request URL vì token có thể nằm rành rành trong query param.

## 5. Validation flow
Quy trình xác thực gồm các bước tuần tự (5A):
1. Extract `device_code`.
2. Tìm record trong `iot_devices` theo `device_code`.
   - Nếu không tồn tại: ném lỗi `404 NotFoundException` với code `IOT_DEVICE_NOT_FOUND`.
3. Check `device_type === IotDeviceType.DOOR_FACE_TERMINAL`.
   - Nếu sai: ném lỗi `409 ConflictException` với code `DEVICE_TYPE_NOT_FACE_SERVER`.
4. Check `metadata_json.face_server_config.callback_enabled === true`.
   - Nếu false hoặc không tồn tại cấu hình này: ném lỗi `409 ConflictException` với code `FACE_CALLBACK_NOT_ENABLED`.
5. Extract `callback_token`.
6. Xác thực token:
   - Dùng `crypto.createHash('sha256')` băm token nhận được.
   - So sánh hash vừa tạo với `metadata_json.face_server_config.callback_token_hash` đang lưu trong DB.
   - Ưu tiên dùng `crypto.timingSafeEqual` để so sánh an toàn hơn.
   - Nếu không khớp: ném lỗi `401 UnauthorizedException` với code `INVALID_CALLBACK_TOKEN`.
7. Check `allowed_source_ip` theo hướng best-effort.
8. Nếu vượt qua mọi bước trên → Proceed xử lý heartbeat.

## 6. Short token compatibility with IOT-003
- **Vấn đề:** Hiện tại plain token do UC IOT-003 sinh ra quá dài, làm cho URL vượt quá giới hạn "News Letter Exceed!" của Face Server.
- **Giải pháp:** Cần có task nhỏ quay lại update logic token generation ở `configureFaceServer` (IOT-003) nếu nó đang sinh token dài.
- Token mới nên dùng format ngắn, ví dụ: `crypto.randomBytes(16).toString('base64url')` (sẽ sinh ra chuỗi khoảng 22 ký tự).
- **Database Schema KHÔNG đổi:** 
  - Vẫn lưu `callback_token_hash` bằng SHA-256.
  - Vẫn lưu `callback_token_last4`.
  - Tuyệt đối không lưu plain token.
- Sau khi đổi thuật toán sinh token, người quản trị (User/Admin) cần chủ động gọi lại API configure Face Server để nhận `one_time_callback_token` ngắn mới.
- Do backend không lưu plain token, nên không thể trích xuất lại token cũ từ DB để cấp lại cho user.

## 7. `allowed_source_ip` best-effort
- Nếu `allowed_source_ip` trong config không có giá trị (null/undefined): Skip bước check này.
- Nếu có giá trị:
  - Lấy client IP từ request context (`req.ip` hoặc `req.socket.remoteAddress`).
  - Chuẩn hóa (normalize) địa chỉ IPv4-mapped IPv6 (ví dụ: cắt tiền tố `::ffff:192.168.2.3` thành `192.168.2.3`).
  - Nếu IP client xác định rõ ràng và không khớp với `allowed_source_ip`: ném lỗi `403 ForbiddenException` với code `SOURCE_IP_NOT_ALLOWED`.
  - Nếu IP client thuộc nhóm không xác định chắc chắn (VD: do chạy local dev `127.0.0.1`, `::1`, proxy): **Skip block**, chỉ ghi log warning để không cản trở việc local testing.
  - IP Face Server thật trong LAN dự kiến là: `192.168.2.3`.

## 8. Process heartbeat
Khi request đã hợp lệ hoàn toàn:
- Cập nhật entity `IotDevice`:
  - `last_seen_at = new Date()` (now)
  - `status = 'online'`
  - `health_status = 'healthy'`
  - Cập nhật `updated_at` (TypeORM sẽ auto update nếu đang dùng `@UpdateDateColumn`).
- Tiến hành cập nhật `metadata_json.last_heartbeat` theo cơ chế **merge object** (sử dụng spread operator `...`). Không được phép replace/ghi đè trắng toàn bộ `metadata_json`.

## 9. Metadata update
- Trường `metadata_json.last_heartbeat` cần lưu lại các thông tin:
  - `received_at`: thời điểm nhận request.
  - `source_ip`: IP đã được chuẩn hóa.
  - `payload_timestamp`: lấy từ `body.timestamp` (nếu body có).
  - `device_status`: lấy từ `body.status` (nếu body có).
  - `raw_payload_sample`: toàn bộ body request (hoặc `{}` nếu rỗng) đã được làm sạch qua logic masking.
- BẮT BUỘC giữ nguyên các khối metadata hiện tại (nếu có):
  - `face_server_config`
  - `rtsp_config`
  - `last_availability_check`
  - `vendor`
  - `connection`
  - Bất kỳ metadata bổ sung nào khác.

## 10. Sensitive data masking
- Sử dụng lại utility function `maskSensitiveMetadata()` đã có sẵn từ IOT-003/IOT-004.
- Không lưu plain `callback_token` vào bên trong `raw_payload_sample`.
- Logic masking phải duyệt và mask (hoặc remove) các key có chứa các từ khóa nhạy cảm: `secret`, `token`, `password`.
- **Response Contract (Bảo mật):** Phản hồi API trả về tuyệt đối KHÔNG ĐƯỢC CHỨA:
  - `callback_token`
  - `callback_token_hash`
  - `callback_token_last4`
  - `rtsp_password`
  - `rtsp_password_encrypted`
  - Bất kỳ secret, token hay password nào.

## 11. Service structure
- `DeviceCallbacksController` và `ShortDeviceCallbacksController` chỉ nhận request (đọc req headers, body, query, ip) và truyền dữ liệu cho service.
- Tạo interface nội bộ `HeartbeatInput` trong service.
- Method mới: `async receiveHeartbeat(input: HeartbeatInput)` thuộc `IotDevicesService`.
- Method `receiveHeartbeat()` sẽ đóng gói toàn bộ logic: extraction thứ tự ưu tiên, validation 5A, token verification, IP check, db update.
- Đảm bảo tuân thủ "Không duplicate logic" giữa GET, POST, canonical URL và alias URL.

## 12. Transaction / database update
- Dùng `QueryRunner` hoặc `EntityManager` của TypeORM theo đúng convention đang sử dụng hiện tại trong `IotDevicesService`.
- Phải wrap thao tác `save()` thiết bị trong một transaction.
- Nếu `save()` throw lỗi, trả về HTTP `500 Internal Server Error`, không được nuốt lỗi và trả success giả (false positive).
- Không được tạo bảng mới.
- Không tạo/ghi dữ liệu vào `audit_logs` để tránh tình trạng db phình to nhanh chóng (bloat) do heartbeat ping liên tục 30s một lần.

## 13. Response contract
**Success response (HTTP 200):**
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

## 14. Test strategy
Sẽ cần phủ toàn bộ test cho các case sau:
- GET `/api/v1/hb?d=<device_code>&t=<short_token>` thành công (Hardware Alias GET).
- POST `/api/v1/hb?d=<device_code>&t=<short_token>` thành công (Hardware Alias POST).
- GET canonical endpoint (`/api/v1/device-callbacks/face/heartbeat`) thành công.
- POST canonical endpoint thành công.
- Request bằng Header `X-Device-Code` + `X-Callback-Token` thành công (Postman).
- Request bằng Body JSON `device_code` + `callback_token` thành công (Postman).
- Request gửi Body rỗng vẫn thành công nếu query param hoặc header cung cấp đủ dữ liệu.
- Missing `device_code` → ném `400 DEVICE_CODE_REQUIRED`.
- Device không tồn tại trong DB → ném `404 IOT_DEVICE_NOT_FOUND`.
- Device type không phải `door_face_terminal` → ném `409 DEVICE_TYPE_NOT_FACE_SERVER`.
- Callback chưa enable (thiếu config hoặc false) → ném `409 FACE_CALLBACK_NOT_ENABLED`.
- Missing callback token → ném `401 CALLBACK_TOKEN_REQUIRED`.
- Invalid callback token (sai token) → ném `401 INVALID_CALLBACK_TOKEN`.
- Source IP mismatch rõ ràng → ném `403 SOURCE_IP_NOT_ALLOWED`.
- Test kiểm tra heartbeat thành công sẽ update đúng `last_seen_at`, `status = 'online'`, `health_status = 'healthy'`.
- Test đảm bảo metadata cũ (rtsp_config, v.v.) không bị xóa mất.
- Test kiểm tra `raw_payload_sample` không bị rò rỉ token/password/secret do đã được qua masking.
- Test đảm bảo response API không bị lộ token/hash/password.
- Đảm bảo trong quá trình code, tuyệt đối KHÔNG `logger.log(full_url)` hoặc `logger.error(full_url)` để tránh rò rỉ query token ra log.
- Test xác nhận: KHÔNG tạo attendance record, KHÔNG ghi no-show, KHÔNG start/stop recording.
- Test xác nhận: KHÔNG gọi tới repository ghi audit log.
