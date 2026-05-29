# Tasks: Cấu hình thông tin kết nối Face Server (IOT-003)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `IotDevice` entity hiện tại để đảm bảo các trường `metadataJson`, `roomId`, `deviceType` đã được định nghĩa.
- [x] Khảo sát `IotDevicesService` và `IotDevicesController` đã có từ IOT-001/IOT-002.
- [x] Khảo sát `IotAuditRepository` và các hàm audit từ UC trước.
- [x] Phân tích hàm mapper `toIotDeviceResponse` hiện tại xem có đang trả raw `metadata_json` không.
- [x] Kiểm tra module Auth hoặc utils (`crypto`) để chuẩn bị cho việc sinh token và băm (hash) token.
- [x] Thống nhất lại convention về Exception và Error Code đang dùng (`NotFoundException`, `ConflictException`, etc.).

## 2. Response mapper security
- [x] Sửa file `src/modules/iot/dto/iot-device-response.dto.ts` để cập nhật hàm mapper chung `toIotDeviceResponse`.
- [x] Đảm bảo mapper chủ động `delete` hoặc mask `metadata_json.face_server_config.callback_token_hash`.
- [x] Xác nhận rule bảo mật này được áp dụng cho toàn bộ response trả về `iot_devices` (list/detail), không được trả `callback_token_hash` ra ngoài.

## 3. DTO
- [x] Tạo file `src/modules/iot/dto/configure-face-server.dto.ts`.
- [x] Định nghĩa class `ConfigureFaceServerDto`.
- [x] Thêm validation cho `callback_enabled` (optional boolean).
- [x] Thêm validation cho `callback_protocol` (`@IsIn(['http', 'https'])`).
- [x] Thêm validation cho `callback_base_url` (optional, `@IsUrl`).
- [x] Thêm validation cho `allowed_source_ip` (required, `@IsIP`).
- [x] Thêm validation cho `heartbeat_path`, `verify_path`, `stranger_path` (required string, `@Matches(/^\/[a-zA-Z0-9-_\/]+$/)`).

## 4. Token utility
- [x] (Nếu cần) Bổ sung logic/hàm sinh plain token bằng `crypto.randomBytes(32).toString('hex')`.
- [x] (Nếu cần) Bổ sung logic/hàm băm (hash) token bằng SHA-256 (`crypto.createHash('sha256').update(plain).digest('hex')`).
- [x] Đảm bảo chỉ trích xuất `callback_token_last4` từ plain token.
- [x] Tuyệt đối không log plain token hoặc lưu plain token raw vào DB.

## 5. Audit
- [x] Cập nhật file `src/modules/iot/repositories/iot-audit.repository.ts`.
- [x] Thêm method `logConfigureFaceServer(manager: EntityManager, data: any)`.
- [x] Thiết lập lưu vào `audit_logs`: `user_id`, `action_type = 'configure_face_server'`, `entity_type = 'iot_devices'`, `entity_id = deviceId`, `severity = 'info'`.
- [x] Chỉ lưu các field không nhạy cảm vào `metadata_json` (IP, URL, các path, last4). Không ghi `one_time_callback_token` và `callback_token_hash`.

## 6. Service & Transaction
- [x] Cập nhật file `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo method `configureFaceServer(userId: string, deviceId: string, dto: ConfigureFaceServerDto)`.
- [x] Triển khai validation nội tại: kiểm tra thiết bị tồn tại (`NotFoundException`).
- [x] Triển khai validation business: check `deviceType === IotDeviceType.DOOR_FACE_TERMINAL` -> `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Triển khai validation business: check `roomId` khác null -> `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [x] Xử lý logic gán default `callback_enabled = true` nếu payload không truyền.
- [x] Sinh token mới và băm token để chuẩn bị update. Token cũ tự động bị ghi đè.
- [x] Khởi tạo TypeORM `QueryRunner` để bắt đầu transaction.
- [x] Merge dữ liệu vào `metadata_json.face_server_config` (dùng spread operator bảo toàn metadata cũ).
- [x] Lưu entity dùng `queryRunner.manager.save(IotDevice, device)` để trigger `updated_at`.
- [x] Gọi `iotAuditRepository.logConfigureFaceServer` trong cùng transaction.
- [x] Bắt lỗi và rollback transaction nếu audit log thất bại.
- [x] Trả về object thiết bị kèm field riêng `one_time_callback_token` (plain).

## 7. Controller
- [x] Cập nhật file `src/modules/iot/controllers/iot-devices.controller.ts`.
- [x] Thêm endpoint `PATCH /api/v1/iot-devices/:id/face-server-config`.
- [x] Gắn guard JWT và permission `@Permissions('iot_devices:configure_face_server')`.
- [x] Bắt param `:id` qua UUID Pipe.
- [x] Gọi hàm từ service, map response trả về kèm `one_time_callback_token`.

## 8. Tests
- [x] Cập nhật file `src/modules/iot/services/iot-devices.service.spec.ts`.
- [x] Unit test happy path: Cấu hình thành công, token được sinh, băm được lưu, transaction hoạt động.
- [x] Unit test re-config: Gọi PATCH lần 2, kiểm tra token mới được sinh và đè vào hash.
- [x] Unit test optional param: Không truyền `callback_enabled`, kiểm tra service tự set default `true`.
- [x] Unit test `NotFoundException`: Thiết bị không tồn tại -> `IOT_DEVICE_NOT_FOUND`.
- [x] Unit test `ConflictException`: Sai loại thiết bị -> `DEVICE_TYPE_NOT_FACE_SERVER`.
- [x] Unit test `ConflictException`: Thiết bị chưa gán phòng -> `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [x] Unit test Rollback: DB Audit lỗi -> `QueryRunner` gọi hàm rollbackTransaction.
- [x] Unit test Mapper: Đảm bảo `toIotDeviceResponse` không bao giờ trả ra field `callback_token_hash`.

## 9. Final verification
- [x] Chạy lệnh `npm run lint` hoặc `npx eslint` để đảm bảo code chuẩn convention.
- [x] Chạy lệnh `npm run test` để pass toàn bộ unit test.
- [x] Chạy lệnh `npm run build` hoặc `nest build` để xác nhận biên dịch không lỗi.
