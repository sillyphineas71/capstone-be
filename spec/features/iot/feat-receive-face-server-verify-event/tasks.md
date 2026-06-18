---
name: feat-receive-face-server-verify-event
description: Tasks for receiving verify events from Face Server (IOT-007)
category: iot
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-02 | Khởi tạo Tasks list cho IOT-007 | Toàn bộ file |
| 2026-06-02 | Hoàn thành tất cả các tasks cho IOT-007 | Toàn bộ file |

# Danh sách công việc (Tasks) - IOT-007

## 1. Kiểm tra codebase hiện tại

- [x] Kiểm tra `src/modules/iot/iot.module.ts` để biết cách đăng ký controller.
- [x] Kiểm tra `src/modules/iot/controllers/device-callbacks.controller.ts` đã có heartbeat endpoints từ IOT-006 chưa.
- [x] Kiểm tra `src/modules/iot/controllers/short-device-callbacks.controller.ts` để tránh nhầm với route `hb`.
- [x] Kiểm tra `src/modules/iot/services/iot-devices.service.ts` và helper đã có từ IOT-006 như `extractValue`, verify token, normalize IP.
- [x] Kiểm tra `IotDevice` entity có `deviceCode`, `deviceType`, `lastSeenAt`, `status`, `healthStatus`, `metadataJson`.
- [x] Kiểm tra enum `IotDeviceType.DOOR_FACE_TERMINAL`.
- [x] Kiểm tra `maskSensitiveMetadata()` trong `src/common/utils/masking.util.ts`.
- [x] Kiểm tra project đã có `@nestjs/platform-express` / multer support chưa.

## 2. Canonical verify endpoints

- [x] Cập nhật `src/modules/iot/controllers/device-callbacks.controller.ts`.
- [x] Thêm endpoint `GET /api/v1/device-callbacks/face/verify`.
- [x] Thêm endpoint `POST /api/v1/device-callbacks/face/verify`.
- [x] GET và POST phải gọi chung service method `IotDevicesService.receiveVerifyEvent(...)`.
- [x] Không duplicate business logic.
- [x] Không gắn `JwtAuthGuard`.
- [x] Không gắn `PermissionsGuard`.
- [x] Không dùng strict DTO.
- [x] Với POST, dùng `AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } })` nếu cần parse multipart/form-data.
- [x] GET không cần `AnyFilesInterceptor`.
- [x] Lấy request context từ `@Req()`: headers, body, query, params, ip/socket remoteAddress, files nếu có.
- [x] Không log full URL vì token có thể nằm trong path/query.

## 3. Short alias verify controller

- [x] Tạo file `src/modules/iot/controllers/verify-short-device-callbacks.controller.ts`.
- [x] Đặt controller prefix `@Controller('vf')`.
- [x] Thêm endpoint `GET /api/v1/vf/:deviceCode/:callbackToken`.
- [x] Thêm endpoint `POST /api/v1/vf/:deviceCode/:callbackToken`.
- [x] Cả GET và POST gọi chung `IotDevicesService.receiveVerifyEvent(...)`.
- [x] Không duplicate logic với canonical controller.
- [x] Không gắn `JwtAuthGuard`.
- [x] Không gắn `PermissionsGuard`.
- [x] Với POST, dùng `AnyFilesInterceptor({ limits: { fileSize: 5 * 1024 * 1024, files: 5 } })`.
- [x] Không lưu/log file buffer.
- [x] Không log full URL vì token nằm trong path param.

## 4. Đăng ký controller trong module

- [x] Cập nhật `src/modules/iot/iot.module.ts`.
- [x] Thêm `VerifyShortDeviceCallbacksController` vào `controllers`.
- [x] Đảm bảo `DeviceCallbacksController` vẫn hoạt động cho heartbeat và verify canonical endpoints.
- [x] Đảm bảo không ảnh hưởng Admin API controller.

## 5. Service method

- [x] Cập nhật `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo internal input interface/type cho verify event request context.
- [x] Tạo method `receiveVerifyEvent(input)`.
- [x] Method xử lý chung cho GET/POST/canonical/alias.
- [x] Tái sử dụng helper từ IOT-006 nếu có, tránh copy-paste lệch logic.
- [x] Không xử lý attendance/check-in/check-out/presence/no-show/stranger/recording trong method này.

## 6. Extract và normalize `device_code`

- [x] Extract `device_code` theo thứ tự:
  1. Header `X-Device-Code` / `x-device-code`
  2. Body JSON `device_code`
  3. Query param `device_code`
  4. Query param `d`
  5. Path param `deviceCode`
- [x] Nếu value là array, lấy phần tử đầu tiên.
- [x] Trim string value.
- [x] Nếu thiếu hoặc rỗng, throw `BadRequestException` với code `DEVICE_CODE_REQUIRED`.

## 7. Extract và normalize `callback_token`

- [x] Extract `callback_token` theo thứ tự:
  1. Header `X-Callback-Token` / `x-callback-token`
  2. Body JSON `callback_token`
  3. Query param `callback_token`
  4. Query param `t`
  5. Path param `callbackToken`
- [x] Nếu value là array, lấy phần tử đầu tiên.
- [x] Trim string value.
- [x] Nếu thiếu hoặc rỗng, throw `UnauthorizedException` với code `CALLBACK_TOKEN_REQUIRED`.
- [x] Không log plain callback token.
- [x] Không lưu plain callback token vào DB.
- [x] Không log full request URL.

## 8. Validation flow

- [x] Tìm device trong `iot_devices` theo `device_code`.
- [x] Nếu không tồn tại, throw `NotFoundException` với code `IOT_DEVICE_NOT_FOUND`.
- [x] Nếu `deviceType !== IotDeviceType.DOOR_FACE_TERMINAL`, throw `ConflictException` với code `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Kiểm tra `metadataJson.face_server_config.callback_enabled === true`.
- [x] Nếu callback chưa enable hoặc config thiếu, throw `ConflictException` với code `FACE_CALLBACK_NOT_ENABLED`.
- [x] Kiểm tra tồn tại `callback_token_hash`.
- [x] Nếu không có `callback_token_hash`, throw error theo convention hiện có với code `CALLBACK_TOKEN_NOT_CONFIGURED`.

## 9. Verify callback token

- [x] Hash incoming `callback_token` bằng SHA-256.
- [x] So sánh với `metadataJson.face_server_config.callback_token_hash`.
- [x] Nếu có thể, dùng `crypto.timingSafeEqual`.
- [x] Nếu token sai, throw `UnauthorizedException` với code `INVALID_CALLBACK_TOKEN`.
- [x] Không trả token/hash trong response.

## 10. Allowed source IP best-effort

- [x] Reuse/helper logic từ IOT-006 nếu có.
- [x] Lấy client IP từ `req.ip` hoặc `req.socket.remoteAddress`.
- [x] Normalize IPv4-mapped IPv6 dạng `::ffff:192.168.2.3`.
- [x] Nếu `allowed_source_ip` không có giá trị thì skip check.
- [x] Nếu có `allowed_source_ip` và client IP rõ ràng, so sánh với IP normalized.
- [x] Nếu không khớp, throw `ForbiddenException` với code `SOURCE_IP_NOT_ALLOWED`.
- [x] Nếu client IP không xác định chắc chắn trong local/proxy/dev, skip check và log warning.
- [x] Không log token khi log warning.

## 11. Payload tolerant ingestion

- [x] Hỗ trợ JSON body nếu có.
- [x] Hỗ trợ form-data nếu có.
- [x] Hỗ trợ multipart/form-data nếu có.
- [x] Body rỗng không được làm server crash.
- [x] Nếu payload không parse được, vẫn tạo sample tối thiểu gồm:
  * `content_type`
  * `content_length`
  * `method`
  * `source_ip`
  * `received_at`
- [x] Nếu có `req.files`, chỉ lấy file metadata:
  * `fieldname`
  * `originalname`
  * `mimetype`
  * `size`
- [x] Không lưu `file.buffer`.
- [x] Không log `file.buffer`.
- [x] Không lưu binary image/base64 image vào `metadataJson`.

## 12. Build verify payload sample

- [x] Tạo `raw_payload_sample` bằng cách gộp body text fields và file metadata.
- [x] Chạy `maskSensitiveMetadata()` trước khi lưu.
- [x] Truncate text field dài, ví dụ giới hạn 2000 ký tự.
- [x] Nếu có truncate, thêm flag `truncated: true`.
- [x] Không lưu field chứa `secret`, `token`, `password` ở dạng plain.
- [x] Cố gắng extract một số field nếu có:
  * `person_id`
  * `person_name`
  * `verify_time`
  * `verify_result`
  * `similarity`
- [x] Nếu không detect được field thì để null/undefined, không throw lỗi.

## 13. DB update

- [x] Khi verify event hợp lệ, update:
  * `lastSeenAt = now`
  * `status = online`
  * `healthStatus = healthy`
- [x] Clone/merge `metadataJson` cũ.
- [x] Update `metadataJson.last_verify_event_sample = newSample`.
- [x] Update `metadataJson.recent_verify_event_samples = [newSample, ...oldSamples].slice(0, 5)`.
- [x] Event mới nhất nằm ở index 0.
- [x] Không replace toàn bộ `metadataJson`.
- [x] Không xóa metadata cũ:
  * `face_server_config`
  * `last_heartbeat`
  * `last_availability_check`
  * `rtsp_config`
  * `vendor`
  * `connection`
  * metadata khác nếu có.
- [x] Không tạo bảng mới.
- [x] Không ghi audit log.

## 14. Response contract

- [x] Response success trả:
  * `success = true`
  * `message = "Verify event received successfully"`
  * `data.device_code`
  * `data.event_type = "face_verify"`
  * `data.received_at`
- [x] Response không chứa:
  * `callback_token`
  * `callback_token_hash`
  * `callback_token_last4`
  * `rtsp_password`
  * `rtsp_password_encrypted`
  * binary image
  * base64 image
  * bất kỳ secret/token/password nào.

## 15. Unit tests cho service

- [x] Test GET `/api/v1/vf/:deviceCode/:callbackToken` thành công.
- [x] Test POST `/api/v1/vf/:deviceCode/:callbackToken` thành công.
- [x] Test canonical GET/POST thành công.
- [x] Test request bằng header `X-Device-Code` + `X-Callback-Token` thành công.
- [x] Test request bằng body JSON `device_code` + `callback_token` thành công.
- [x] Test body rỗng không crash nếu path/header/query đủ token.
- [x] Test form-data/multipart không crash.
- [x] Test missing `device_code` → `BadRequestException` / `DEVICE_CODE_REQUIRED`.
- [x] Test device không tồn tại → `NotFoundException` / `IOT_DEVICE_NOT_FOUND`.
- [x] Test device type không phải `door_face_terminal` → `ConflictException` / `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Test callback chưa enable → `ConflictException` / `FACE_CALLBACK_NOT_ENABLED`.
- [x] Test missing callback token → `UnauthorizedException` / `CALLBACK_TOKEN_REQUIRED`.
- [x] Test invalid callback token → `UnauthorizedException` / `INVALID_CALLBACK_TOKEN`.
- [x] Test source IP mismatch rõ ràng → `ForbiddenException` / `SOURCE_IP_NOT_ALLOWED`.
- [x] Test event hợp lệ update `last_seen_at`, `status`, `health_status`.
- [x] Test `last_verify_event_sample` được cập nhật.
- [x] Test `recent_verify_event_samples` tối đa 5 item.
- [x] Test event mới nhất nằm ở index 0.
- [x] Test metadata cũ không bị xóa.
- [x] Test `raw_payload_sample` không chứa token/password/secret.
- [x] Test file buffer không bị lưu vào DB.
- [x] Test response không lộ token/hash/password.
- [x] Test không tạo attendance/check-in/check-out/presence/no-show.
- [x] Test không ghi audit log.

## 16. Controller/manual integration tests

- [x] Test bằng Postman với GET short alias.
- [x] Test bằng Postman với POST short alias.
- [x] Test bằng Postman với canonical GET/POST.
- [x] Test bằng Postman với header.
- [x] Test bằng Postman với body JSON.
- [x] Test bằng curl multipart giả lập Snap: `curl -X POST "http://localhost:3000/api/v1/vf/TEST-CAM-001/<token>" -F "person_id=123" -F "image=@/path/to/dummy.jpg"`
- [x] Cấu hình Face Server thật:
  * `Verify Subscription = Verify without Pic`
  * `Verify URL = /api/v1/vf/TEST-CAM-001/<short_token>`
- [x] Cho người quét mặt hoặc quẹt thẻ trên camera.
- [x] Kiểm tra PostgreSQL: `metadata_json->'last_verify_event_sample'`, `metadata_json->'recent_verify_event_samples'`
- [x] Xác nhận `recent_verify_event_samples` lưu đúng sample.
- [x] Nếu `Verify without Pic` không hoạt động hoặc thiếu dữ liệu, thử fallback:
  1. `Verify with Reg`
  2. `Verify(Reg + Snap)`
  3. `Verify with Snap`

## 17. Final verification

- [x] Chạy linter toàn project (`npm run lint` hoặc command tương đương).
- [x] Chạy toàn bộ test (`npm run test` hoặc command tương đương).
- [x] Chạy build project (`npm run build` hoặc command tương đương).
- [x] Nếu không chạy được, ghi rõ lý do và command cần chạy.
- [x] Cập nhật checkbox trong `tasks.md`.
- [x] Ghi walkthrough ngắn sau khi implement: file đã sửa, endpoint đã thêm, test đã chạy, case camera thật đã/chưa test.
