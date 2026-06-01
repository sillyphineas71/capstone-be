# Tasks: Cấu hình RTSP cho IP Camera góc phòng (IOT-004)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `IotDevice` entity có `metadataJson`, `roomId`, `deviceType` chưa.
- [x] Kiểm tra `IotDevicesService`/`IotDevicesController` hiện có từ IOT-001 đến IOT-003.
- [x] Kiểm tra `IotAuditRepository` hiện có các hàm audit trước đó.
- [x] Kiểm tra mapper `toIotDeviceResponse` hiện đang xử lý `metadata_json` như thế nào.
- [x] Kiểm tra convention exception/error code hiện tại.
- [x] Kiểm tra enum `IotDeviceType` hiện có `ip_room_camera` và `room_camera` không.

## 2. DTO
- [x] Tạo file `src/modules/iot/dto/configure-rtsp.dto.ts`.
- [x] Định nghĩa class `ConfigureRtspDto`.
- [x] Validate `rtsp_enabled`: optional boolean, default `true` ở service.
- [x] Validate `rtsp_protocol`: chỉ nhận `rtsp` hoặc `rtsps` (`@IsIn`).
- [x] Validate `rtsp_host`: required, IP hoặc hostname hợp lệ, không chứa protocol, username, password, port hoặc path.
- [x] Validate `rtsp_port`: optional number, default 554, range 1–65535 (`@Min`, `@Max`).
- [x] Validate `rtsp_path`: required string, bắt đầu bằng `/`, không rỗng, không chứa full URL/domain.
- [x] Validate `rtsp_username`: optional string.
- [x] Validate `rtsp_password`: optional string.
- [x] Validate `stream_profile`: optional string, default `main`.

## 3. Response mapper security
- [x] Cập nhật mapper chung `toIotDeviceResponse` trong `iot-device-response.dto.ts`.
- [x] Đảm bảo mapper không được trả `rtsp_password`.
- [x] Đảm bảo mapper không được trả `rtsp_password_encrypted`.
- [x] Đảm bảo mapper phải trả `rtsp_password_configured: true/false` nếu `metadata_json.rtsp_config` tồn tại.
- [x] Rule này áp dụng cho mọi API trả về `iot_devices`, không chỉ IOT-004.
- [x] Đảm bảo các rule cũ của IOT-003 vẫn giữ nguyên: không trả `callback_token_hash`.

## 4. Service
- [x] Cập nhật file `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo method `configureRtsp(userId: string, deviceId: string, dto: ConfigureRtspDto)`.
- [x] Validate device tồn tại, nếu không trả `IOT_DEVICE_NOT_FOUND`.
- [x] Validate `deviceType` chỉ cho phép `ip_room_camera` và `room_camera` nếu enum/codebase có `room_camera`. Nếu sai type trả `DEVICE_TYPE_NOT_RTSP_CAMERA`.
- [x] Validate `roomId` khác null, nếu chưa gán phòng trả `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [x] Set default `rtsp_enabled = true` nếu không truyền.
- [x] Set default `rtsp_port = 554` nếu không truyền.
- [x] Set default `stream_profile = 'main'` nếu không truyền.
- [x] Merge config vào `metadata_json.rtsp_config`, không xóa metadata khác như `face_server_config`.
- [x] Nếu request có `rtsp_password`, overwrite password cũ.
- [x] Nếu request không có `rtsp_password`, giữ nguyên password cũ nếu config cũ đã có. Không tự động xóa password cũ.
- [x] Đảm bảo không test kết nối RTSP trong method này.

## 5. Audit
- [x] Cập nhật `src/modules/iot/repositories/iot-audit.repository.ts`.
- [x] Thêm method `logConfigureRtsp`.
- [x] Method nhận `EntityManager` để chạy chung transaction.
- [x] Ghi `audit_logs`:
  - `user_id`
  - `action_type = configure_rtsp`
  - `entity_type = iot_devices`
  - `entity_id = deviceId`
  - `severity = info`
  - `metadata_json` chỉ chứa field không nhạy cảm: `rtsp_enabled`, `rtsp_protocol`, `rtsp_host`, `rtsp_port`, `rtsp_path`, `rtsp_username` nếu được phép, `stream_profile`, `rtsp_password_configured`.
- [x] Đảm bảo không ghi `rtsp_password` và không ghi `rtsp_password_encrypted`.

## 6. Transaction
- [x] Dùng TypeORM `QueryRunner` hoặc `EntityManager`.
- [x] Update `iot_devices.metadata_json` và insert `audit_logs` trong cùng transaction.
- [x] Bắt exception: Nếu audit log lỗi thì rollback config update.
- [x] Đảm bảo `updated_at` được tự động cập nhật khi save/update entity.

## 7. Controller
- [x] Cập nhật `src/modules/iot/controllers/iot-devices.controller.ts`.
- [x] Thêm endpoint `PATCH /api/v1/iot-devices/:id/rtsp-config`.
- [x] Validate param `:id` bằng UUID pipe hoặc convention hiện có.
- [x] Gắn JWT guard và permission `iot_devices:configure_rtsp`. Không hard-code role Admin/Manager.
- [x] Gọi `IotDevicesService.configureRtsp(req.user.id, id, dto)`.
- [x] Trả response qua hàm mapper `toIotDeviceResponse`.

## 8. Tests
- [x] Unit test happy path configure RTSP.
- [x] Unit test invalid device type -> `DEVICE_TYPE_NOT_RTSP_CAMERA`.
- [x] Unit test device chưa gán phòng -> `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [x] Unit test full RTSP URL trong `rtsp_host` bị reject.
- [x] Unit test invalid `rtsp_path` bị reject.
- [x] Unit test invalid `rtsp_port` bị reject.
- [x] Unit test re-config có password mới thì overwrite password cũ.
- [x] Unit test re-config không truyền password thì giữ password cũ.
- [x] Unit test response không lộ `rtsp_password` hoặc `rtsp_password_encrypted`.
- [x] Unit test mapper trả `rtsp_password_configured` đúng.
- [x] Unit test audit log không chứa password.
- [x] Unit test rollback nếu audit log lỗi.
- [x] Unit test không có logic test RTSP connection trong UC này.

## 9. Final verification
- [x] Chạy lệnh `npm run lint` hoặc command tương đương để check code convention.
- [x] Chạy lệnh `npm run test` để chạy bộ Unit Test và pass 100%.
- [x] Chạy lệnh `npm run build` để đảm bảo code biên dịch (compile) thành công.
- [x] Cập nhật kết quả vào Checkbox. Nếu có lỗi phải ghi chú rõ lỗi ở đâu.
