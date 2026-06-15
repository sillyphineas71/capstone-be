# Tasks: Kiểm tra trạng thái khả dụng của camera (IOT-005)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `src/modules/iot/entities/iot-device.entity.ts`.
- [x] Kiểm tra enum/value hiện có của `status`.
- [x] Kiểm tra enum/value hiện có của `health_status`.
- [x] Xác nhận các value có thể dùng:
  - `status`: `online`, `offline`
  - `health_status`: `healthy`, `unhealthy`, `unknown`, `not_configured`
- [x] Nếu codebase chưa hỗ trợ `not_configured`, không tự ý thêm enum/migration nếu chưa ghi rõ. Ghi rõ sẽ fallback sang `unknown` hoặc tạo task riêng nếu cần update enum.
- [x] Kiểm tra `iot-devices.service.ts` hiện có các method từ IOT-001 đến IOT-004.
- [x] Kiểm tra `iot-devices.controller.ts` hiện có route convention như thế nào.
- [x] Kiểm tra mapper `toIotDeviceResponse` hiện đang mask `rtsp_password`, `rtsp_password_encrypted`, `callback_token`, `callback_token_hash` chưa.
- [x] Kiểm tra convention exception/error code hiện tại.

## 2. Controller
- [x] Cập nhật `src/modules/iot/controllers/iot-devices.controller.ts`.
- [x] Thêm endpoint `POST /api/v1/iot-devices/:id/check-availability`.
- [x] Validate path param `id` bằng `ParseUUIDPipe` hoặc convention hiện có.
- [x] Gắn JWT guard.
- [x] Gắn permission `iot_devices:check_availability`.
- [x] Không hard-code role Admin/Manager.
- [x] Endpoint không nhận request body.
- [x] Lấy `userId` từ `req.user.id`.
- [x] Gọi `IotDevicesService.checkAvailability(userId, id)`.
- [x] Trả response qua mapper/response convention hiện có.

## 3. Service method
- [x] Cập nhật `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo method `checkAvailability(userId: string, deviceId: string)`.
- [x] Tìm device theo `deviceId`.
- [x] Nếu không tồn tại, throw `NotFoundException`.
- [x] Nếu `deviceType` không phải `door_face_terminal` hoặc `ip_room_camera`, throw `ConflictException` với code `DEVICE_TYPE_NOT_CAMERA`.
- [x] Không gọi Python Camera Service.
- [x] Không probe RTSP bằng NestJS/FFmpeg/library.
- [x] Không tạo audit log.

## 4. Face Server availability logic
- [x] Áp dụng cho `deviceType = door_face_terminal`.
- [x] Dùng `last_seen_at` để check heartbeat.
- [x] Threshold = 5 phút.
- [x] Nếu `last_seen_at` trong vòng 5 phút:
  - `is_available = true`
  - `check_type = heartbeat_status`
  - `runtime_verified = true`
  - `reason_code = null`
  - `status = online`
  - `health_status = healthy`
- [x] Nếu `last_seen_at` quá 5 phút:
  - `is_available = false`
  - `check_type = heartbeat_status`
  - `runtime_verified = true`
  - `reason_code = HEARTBEAT_STALE`
  - `status = offline`
  - `health_status = unhealthy`
- [x] Nếu `last_seen_at = null`:
  - `is_available = false`
  - `check_type = heartbeat_status`
  - `runtime_verified = false`
  - `reason_code = HEARTBEAT_NOT_SEEN`
  - `status = offline`
  - `health_status = unknown`

## 5. IP Room Camera config readiness logic
- [x] Áp dụng cho `deviceType = ip_room_camera`.
- [x] Nếu thiếu `roomId`:
  - `is_available = false`
  - `check_type = rtsp_config_readiness`
  - `runtime_verified = false`
  - `reason_code = DEVICE_ROOM_ASSIGNMENT_REQUIRED`
  - `health_status = not_configured` nếu codebase hỗ trợ; nếu không, fallback `unknown`.
  - Giữ nguyên `status`.
- [x] Nếu thiếu `metadataJson.rtsp_config`:
  - `reason_code = RTSP_CONFIG_MISSING`
  - `health_status = not_configured` nếu hỗ trợ; nếu không, fallback `unknown`.
  - Giữ nguyên `status`.
- [x] Nếu `rtsp_enabled = false`:
  - `reason_code = RTSP_DISABLED`
  - `health_status = not_configured` nếu hỗ trợ; nếu không, fallback `unknown`.
  - Giữ nguyên `status`.
- [x] Nếu đủ `rtsp_host`, `rtsp_port`, `rtsp_path`:
  - `is_available = true`
  - `check_type = rtsp_config_readiness`
  - `runtime_verified = false`
  - `reason_code = null`
  - message = `RTSP configuration is ready. Runtime stream probing is not performed in this version.`
  - `health_status = unknown` nếu chưa có `config_ready`.
  - Giữ nguyên `status`, tuyệt đối không set `status = online`.

## 6. Metadata update
- [x] Update `metadataJson.last_availability_check`.
- [x] Lưu các field:
  - `is_available`
  - `check_type`
  - `runtime_verified`
  - `reason_code`
  - `message`
  - `checked_at`
  - `checked_by`
- [x] Dùng merge object, không replace toàn bộ `metadataJson`.
- [x] Không xóa metadata cũ như:
  - `rtsp_config`
  - `face_server_config`
  - `vendor`
  - `connection`
  - các metadata khác.
- [x] Response `availability` không trả `checked_by`.

## 7. Database update / transaction
- [x] Dùng `EntityManager`, `QueryRunner`, hoặc transaction convention hiện có.
- [x] Cập nhật đồng thời:
  - `status`
  - `healthStatus`
  - `metadataJson`
  - `updatedAt` nếu codebase cần set thủ công.
- [x] Nếu save lỗi thì không được trả success.
- [x] Không tạo bảng mới.
- [x] Không ghi `audit_logs`.

## 8. Response mapper / security
- [x] Cập nhật mapper nếu cần trong `src/modules/iot/dto/iot-device-response.dto.ts`.
- [x] Response phải có `availability` lồng trong `data`.
- [x] Response không được expose:
  - `rtsp_password`
  - `rtsp_password_encrypted`
  - `callback_token`
  - `callback_token_hash`
  - bất kỳ secret/token/password nào trong `metadata_json`.
- [x] Kế thừa và không phá rule security từ IOT-003/IOT-004.
- [x] Không trả `checked_by` trong response `availability`.

## 9. Unit tests cho service
- [x] Test device không tồn tại → `NotFoundException`.
- [x] Test device type không hợp lệ → `ConflictException` / `DEVICE_TYPE_NOT_CAMERA`.
- [x] Test `door_face_terminal` heartbeat trong 5 phút → available, online, healthy.
- [x] Test `door_face_terminal` heartbeat quá 5 phút → unavailable, offline, unhealthy, `HEARTBEAT_STALE`.
- [x] Test `door_face_terminal` chưa từng heartbeat → unavailable, offline, unknown, `HEARTBEAT_NOT_SEEN`, `runtime_verified = false`.
- [x] Test `ip_room_camera` thiếu room → `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [x] Test `ip_room_camera` thiếu RTSP config → `RTSP_CONFIG_MISSING`.
- [x] Test `ip_room_camera` RTSP disabled → `RTSP_DISABLED`.
- [x] Test `ip_room_camera` đủ config → config readiness, `runtime_verified = false`, không set `status = online`.
- [x] Test metadata cũ không bị xóa sau khi update `last_availability_check`.
- [x] Test không gọi Python Camera Service.
- [x] Test không gọi RTSP/FFmpeg/OpenCV logic.
- [x] Test không ghi audit log.

## 10. Tests cho response mapper / controller nếu có
- [x] Test response có `availability` trong `data`.
- [x] Test response không trả `checked_by`.
- [x] Test response không lộ `rtsp_password`.
- [x] Test response không lộ `rtsp_password_encrypted`.
- [x] Test response không lộ `callback_token`.
- [x] Test response không lộ `callback_token_hash`.

## 11. Final verification
- [x] Chạy linter toàn project (`npm run lint` hoặc command tương đương).
- [x] Chạy toàn bộ test (`npm run test` hoặc command tương đương).
- [x] Chạy build project (`npm run build` hoặc command tương đương).
- [x] Nếu không chạy được, ghi rõ lý do và command cần chạy.
- [x] Cập nhật checkbox trong `tasks.md`.
- [x] Ghi walkthrough ngắn sau khi implement.
