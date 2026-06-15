# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Tạo/cập nhật `tasks.md` cho IOT-006 để hỗ trợ short URL alias (`/api/v1/hb`) và short query params (`d`, `t`) theo plan đã duyệt | Toàn bộ file |

# Tasks: Nhận heartbeat từ Face Server (IOT-006)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `src/modules/iot/iot.module.ts` để biết cách đăng ký controller.
- [x] Kiểm tra `src/modules/iot/controllers/iot-devices.controller.ts` để nắm convention response/controller hiện có.
- [x] Kiểm tra `src/modules/iot/services/iot-devices.service.ts` để nắm transaction convention bằng `DataSource`/`QueryRunner`.
- [x] Kiểm tra method `configureFaceServer` hoặc logic IOT-003 sinh `one_time_callback_token`.
- [x] Kiểm tra `src/modules/iot/entities/iot-device.entity.ts` để xác nhận field `deviceCode`, `deviceType`, `lastSeenAt`, `status`, `healthStatus`, `metadataJson`.
- [x] Kiểm tra enum `IotDeviceType` có `DOOR_FACE_TERMINAL`.
- [x] Kiểm tra utility `maskSensitiveMetadata()` trong `src/common/utils/masking.util.ts`.
- [x] Kiểm tra cách project đang throw exception/error code như `BadRequestException`, `NotFoundException`, `ConflictException`, `UnauthorizedException`, `ForbiddenException`.

## 2. Cập nhật token generation của IOT-003
- [x] Cập nhật logic sinh callback token trong method cấu hình Face Server, ví dụ `configureFaceServer`.
- [x] Nếu hiện tại token đang dài, đổi sang short token: `crypto.randomBytes(16).toString('base64url')`.
- [x] Đảm bảo plain token khoảng 22 ký tự để phù hợp field `HeartBeat URL` của Face Server.
- [x] Không đổi database schema.
- [x] Vẫn lưu `callback_token_hash` bằng SHA-256.
- [x] Vẫn lưu `callback_token_last4`.
- [x] Không lưu plain token vào DB.
- [x] Response của API configure Face Server vẫn chỉ trả `one_time_callback_token` một lần.
- [x] Thêm/update test cho token generation nếu project có test liên quan.

## 3. Controller canonical cho device callbacks
- [x] Tạo hoặc cập nhật `src/modules/iot/controllers/device-callbacks.controller.ts`.
- [x] Đặt route prefix `device-callbacks`.
- [x] Thêm endpoint `GET /api/v1/device-callbacks/face/heartbeat`.
- [x] Thêm endpoint `POST /api/v1/device-callbacks/face/heartbeat`.
- [x] GET và POST phải gọi chung một handler hoặc cùng gọi một service method.
- [x] Không duplicate business logic.
- [x] Không gắn `JwtAuthGuard`.
- [x] Không gắn `PermissionsGuard`.
- [x] Không dùng strict DTO vì payload từ thiết bị thật có thể rỗng hoặc không cố định.
- [x] Lấy request context từ `@Req()`: headers, body, query, ip/socket remoteAddress.
- [x] Gọi `IotDevicesService.receiveHeartbeat(...)`.
- [x] Trả response success theo contract.

## 4. Short alias controller cho hardware URL ngắn
- [x] Tạo hoặc cập nhật `src/modules/iot/controllers/short-device-callbacks.controller.ts`.
- [x] Đặt route prefix `hb`.
- [x] Thêm endpoint `GET /api/v1/hb`.
- [x] Thêm endpoint `POST /api/v1/hb`.
- [x] Cả GET và POST phải gọi chung `IotDevicesService.receiveHeartbeat(...)`.
- [x] Không duplicate logic với canonical controller.
- [x] Không gắn `JwtAuthGuard`.
- [x] Không gắn `PermissionsGuard`.
- [x] Không log full URL hoặc full query string.

## 5. Đăng ký controllers trong module
- [x] Cập nhật `src/modules/iot/iot.module.ts`.
- [x] Thêm `DeviceCallbacksController` vào `controllers`.
- [x] Thêm `ShortDeviceCallbacksController` vào `controllers`.
- [x] Đảm bảo không ảnh hưởng các Admin API controller hiện có.

## 6. Service method
- [x] Cập nhật `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo internal input interface/type `HeartbeatInput`.
- [x] Tạo method `receiveHeartbeat(input: HeartbeatInput)`.
- [x] Method phải xử lý chung cho GET/POST/canonical/alias.
- [x] Không xử lý verify/stranger/attendance/no-show/recording trong method này.

## 7. Extract và normalize device_code
- [x] Extract `device_code` theo thứ tự:
  1. Header `X-Device-Code` / `x-device-code`
  2. Body JSON `device_code`
  3. Query param `device_code`
  4. Query param `d`
- [x] Nếu value là array, lấy phần tử đầu tiên.
- [x] Trim string value.
- [x] Nếu thiếu hoặc rỗng, throw `BadRequestException` với code `DEVICE_CODE_REQUIRED`.

## 8. Extract và normalize callback_token
- [x] Extract `callback_token` theo thứ tự:
  1. Header `X-Callback-Token` / `x-callback-token`
  2. Body JSON `callback_token`
  3. Query param `callback_token`
  4. Query param `t`
- [x] Nếu value là array, lấy phần tử đầu tiên.
- [x] Trim string value.
- [x] Nếu thiếu hoặc rỗng, throw `UnauthorizedException` với code `CALLBACK_TOKEN_REQUIRED`.
- [x] Không log plain `callback_token`.
- [x] Không lưu plain `callback_token` vào DB.
- [x] Không log full request URL vì token có thể nằm trong query param.

## 9. Validation flow
- [x] Tìm device trong `iot_devices` theo `device_code`.
- [x] Nếu không tồn tại, throw `NotFoundException` với code `IOT_DEVICE_NOT_FOUND`.
- [x] Nếu `deviceType !== IotDeviceType.DOOR_FACE_TERMINAL`, throw `ConflictException` với code `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Kiểm tra `metadataJson.face_server_config.callback_enabled === true`.
- [x] Nếu callback chưa enable hoặc config thiếu, throw `ConflictException` với code `FACE_CALLBACK_NOT_ENABLED`.
- [x] Kiểm tra tồn tại `callback_token_hash`.
- [x] Nếu không có `callback_token_hash`, throw `ConflictException` hoặc `UnauthorizedException` theo convention hiện có, code `CALLBACK_TOKEN_NOT_CONFIGURED`.

## 10. Verify callback token
- [x] Hash incoming `callback_token` bằng SHA-256.
- [x] So sánh với `metadataJson.face_server_config.callback_token_hash`.
- [x] Nếu có thể, dùng `crypto.timingSafeEqual` để so sánh hash an toàn hơn.
- [x] Nếu token sai, throw `UnauthorizedException` với code `INVALID_CALLBACK_TOKEN`.
- [x] Không trả token/hash trong response.

## 11. Allowed source IP best-effort
- [x] Tạo helper/logic lấy client IP từ request (`req.ip` hoặc `req.socket.remoteAddress`).
- [x] Normalize IPv4-mapped IPv6 dạng `::ffff:192.168.2.3` thành `192.168.2.3`.
- [x] Nếu `allowed_source_ip` không có giá trị thì skip check.
- [x] Nếu có `allowed_source_ip` và client IP rõ ràng, so sánh với client IP normalized.
- [x] Nếu không khớp, throw `ForbiddenException` với code `SOURCE_IP_NOT_ALLOWED`.
- [x] Nếu client IP không xác định chắc chắn trong local/proxy/dev, skip check và log warning, không block local testing.
- [x] Không log token khi log warning.

## 12. Process heartbeat DB update
- [x] Dùng `QueryRunner`, `EntityManager`, hoặc transaction convention hiện có.
- [x] Khi validation pass, update:
  - `lastSeenAt = now`
  - `status = online`
  - `healthStatus = healthy`
  - `updatedAt` để TypeORM tự xử lý nếu dùng `@UpdateDateColumn`.
- [x] Không tạo bảng mới.
- [x] Không ghi `audit_logs`.

## 13. Metadata update
- [x] Cập nhật `metadataJson.last_heartbeat`.
- [x] Lưu:
  - `received_at`
  - `source_ip`
  - `payload_timestamp` nếu body có `timestamp`
  - `device_status` nếu body có `status`
  - `raw_payload_sample`
- [x] `raw_payload_sample` lấy từ body nếu có, hoặc `{}` nếu body rỗng.
- [x] Chạy `maskSensitiveMetadata()` trước khi lưu `raw_payload_sample`.
- [x] Không lưu plain `callback_token`.
- [x] Không lưu field chứa `secret`, `token`, `password` ở dạng plain.
- [x] Merge metadata bằng object spread, không replace toàn bộ `metadataJson`.
- [x] Không xóa metadata cũ:
  - `face_server_config`
  - `rtsp_config`
  - `last_availability_check`
  - `vendor`
  - `connection`
  - metadata khác nếu có.

## 14. Response contract
- [x] Response success trả:
  - `success = true`
  - `message = "Heartbeat received successfully"`
  - `data.device_code`
  - `data.status`
  - `data.health_status`
  - `data.last_seen_at`
  - `data.received_at`
- [x] Không dùng `toIotDeviceResponse()` để tránh trả metadata không cần thiết.
- [x] Response không được chứa:
  - `callback_token`
  - `callback_token_hash`
  - `callback_token_last4`
  - `rtsp_password`
  - `rtsp_password_encrypted`
  - bất kỳ secret/token/password nào.

## 15. Unit tests cho service
- [x] Test GET `/api/v1/hb?d=<device_code>&t=<short_token>` thành công.
- [x] Test POST `/api/v1/hb?d=<device_code>&t=<short_token>` thành công.
- [x] Test GET canonical endpoint thành công.
- [x] Test POST canonical endpoint thành công.
- [x] Test request bằng header `X-Device-Code` + `X-Callback-Token` thành công.
- [x] Test request bằng body JSON `device_code` + `callback_token` thành công.
- [x] Test body rỗng vẫn thành công nếu query/header đủ.
- [x] Test cả canonical và alias đều update `last_seen_at`, `status = online`, `health_status = healthy`.
- [x] Test missing `device_code` → `BadRequestException` / `DEVICE_CODE_REQUIRED`.
- [x] Test device không tồn tại → `NotFoundException` / `IOT_DEVICE_NOT_FOUND`.
- [x] Test device type không phải `door_face_terminal` → `ConflictException` / `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Test callback chưa enable → `ConflictException` / `FACE_CALLBACK_NOT_ENABLED`.
- [x] Test missing callback token → `UnauthorizedException` / `CALLBACK_TOKEN_REQUIRED`.
- [x] Test invalid callback token → `UnauthorizedException` / `INVALID_CALLBACK_TOKEN`.
- [x] Test source IP mismatch rõ ràng → `ForbiddenException` / `SOURCE_IP_NOT_ALLOWED`.
- [x] Test metadata cũ không bị xóa.
- [x] Test `raw_payload_sample` không chứa plain `callback_token`, `password`, `secret`.
- [x] Test response không lộ token/hash/password.
- [x] Test không ghi audit log.
- [x] Test không tạo attendance/no-show/recording.

## 16. Manual integration tests
- [x] Test bằng Postman với `GET /api/v1/hb?d=TEST-CAM-001&t=<short_token>`.
- [x] Test bằng Postman với `POST /api/v1/hb?d=TEST-CAM-001&t=<short_token>`.
- [x] Test bằng Postman với canonical GET/POST.
- [x] Test bằng Postman với header.
- [x] Test bằng Postman với body JSON.
- [x] Gọi lại API configure Face Server để lấy `one_time_callback_token` ngắn mới.
- [x] Cấu hình Face Server thật:
  - Service Address: `192.168.2.2`
  - Service Port: `3000`
  - HeartBeat URL: `/api/v1/hb?d=TEST-CAM-001&t=<short_token>`
  - HeartBeat interval: `30`
- [x] Sau khi Face Server gửi heartbeat, kiểm tra DB:
  - `last_seen_at` được cập nhật gần hiện tại.
  - `status = online`.
  - `health_status = healthy`.
  - `metadata_json.last_heartbeat` có dữ liệu.
- [x] Gọi lại IOT-005 để xác nhận camera available.

## 17. Final verification
- [x] Chạy linter toàn project (`npm run lint` hoặc command tương đương).
- [x] Chạy toàn bộ test (`npm run test` hoặc command tương đương).
- [x] Chạy build project (`npm run build` hoặc command tương đương).
- [x] Nếu không chạy được, ghi rõ lý do và command cần chạy.
- [x] Cập nhật checkbox trong `tasks.md`.
- [x] Ghi walkthrough ngắn sau khi implement: file đã sửa, endpoint đã thêm, test đã chạy, case camera thật đã/chưa test.
