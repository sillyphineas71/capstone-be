# Tasks: Register Camera/IoT Device (IOT-001)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra nội dung `src/modules/iot/iot.module.ts` hiện có.
- [x] Kiểm tra convention của controller/service/dto/entity/migration (naming, structure).
- [x] Kiểm tra các auth/permission decorator hiện có (ví dụ `@Permissions()`, `@Roles()`).
- [x] Kiểm tra định dạng chuẩn của response/error trong dự án.
- [x] Kiểm tra convention error code/exception.
- [x] Kiểm tra thư mục migration hiện tại xem bảng `iot_devices` đã từng được tạo chưa.
- [x] Kiểm tra global `ValidationPipe` (ở `main.ts` hoặc config chung) có bật `transform: true` và có cơ chế map chuẩn xác payload snake_case (`@Expose`) sang camelCase không.
- [x] Đọc file `src/modules/auth/repositories/auth-audit.repository.ts` để hiểu cách ghi log vào bảng `audit_logs`.

## 2. Utilities
- [x] Tạo file `src/common/utils/mac.util.ts` (hoặc trong thư mục phù hợp):
  - Viết hàm normalize MAC address (trim, thay `-` thành `:`, uppercase).
- [x] Viết unit test cho `mac.util.ts`.
- [x] Tạo file `src/common/utils/masking.util.ts`:
  - Viết hàm đệ quy `maskSensitiveMetadata(json)`: case-insensitive, tìm key chứa `secret`, `token`, `password` để mask thành `***`.
- [x] Viết unit test cho `maskSensitiveMetadata(json)` cover các case nested objects.

## 3. Migration
- [x] Đánh giá lại kết quả kiểm tra bảng:
  - Nếu `iot_devices` CHƯA tồn tại: Sinh file migration `CreateIotDevicesTable` và định nghĩa toàn bộ bảng với các cột (`id`, `device_code`, `device_name`, `device_type` dạng varchar 50, `ip_address`, `mac_address`, `status`, `health_status`, `last_seen_at`, `metadata_json`, `created_by`, `created_at`, `updated_at`). KHÔNG có `equipment_id`. Thêm unique constraint cho `device_code` và partial unique index cho `mac_address IS NOT NULL`.
  - Nếu `iot_devices` ĐÃ tồn tại: Sinh file migration `UpdateIotDevicesConstraints` để chỉ thêm constraint `device_code` và partial unique index `mac_address` nếu còn thiếu.

## 4. Entity và Enum
- [x] Tạo file `src/modules/iot/entities/iot-device.entity.ts`.
- [x] Định nghĩa `IotDeviceType` (enum cho logic code nội bộ: `door_face_terminal`, `ip_room_camera`, v.v.).
- [x] Định nghĩa class `IotDevice` dùng TypeORM decorators:
  - Properties viết kiểu `camelCase`.
  - Mapped xuống column `snake_case` bằng option `@Column({ name: '...' })`.
  - `deviceType` dùng `type: 'varchar', length: 50`.

## 5. DTO & Response Mapper
- [x] Tạo file `src/modules/iot/dto/create-iot-device.dto.ts`.
- [x] Viết class `CreateIotDeviceDto`:
  - Cấu hình `@Expose({ name: 'snake_case_name' })`. (Nếu class-transformer không được hỗ trợ chuẩn, note lại để controller tự map thủ công từ payload snake_case).
  - Gắn `@Transform` gọi hàm normalize MAC cho `macAddress`.
  - Thêm đầy đủ validation decorator (IsString, IsEnum, IsIP, IsMACAddress, IsObject).
- [x] Tạo file `src/modules/iot/dto/iot-device-response.dto.ts`:
  - Định nghĩa class `IotDeviceResponseDto` chuẩn `snake_case`.
  - Viết hàm mapper `toIotDeviceResponse(entity: IotDevice): IotDeviceResponseDto`.
  - Gọi hàm `maskSensitiveMetadata` trong mapper này.

## 6. Repository (Audit)
- [x] Tạo file `src/modules/iot/repositories/iot-audit.repository.ts`.
- [x] Định nghĩa class `IotAuditRepository` (Injector) với hàm `logDeviceCreation`:
  - Nhận vào `EntityManager` (thay vì tự dùng DataSource) để chạy chung transaction.
  - Chạy SQL INSERT trực tiếp vào `audit_logs` với `action_type = 'create'`, `entity_type = 'iot_devices'`.
  - Giá trị metadata_json ghi log (nếu có) phải chạy qua `maskSensitiveMetadata`.

## 7. Service
- [x] Tạo hoặc cập nhật file `src/modules/iot/services/iot-devices.service.ts`.
- [x] Viết hàm `create(userId: string, dto: CreateIotDeviceDto)`:
  - Khởi tạo TypeORM QueryRunner/EntityManager để bọc Transaction.
  - Check duplicate `device_code`. Throw ConflictException với error code `DEVICE_CODE_EXISTS` nếu tồn tại.
  - Check duplicate normalized `mac_address`. Throw ConflictException với error code `MAC_ADDRESS_EXISTS` nếu tồn tại.
  - Lưu vào `iot_devices` với default: `status = 'offline'`, `health_status = 'unknown'`, `last_seen_at = null`, `created_by = userId`.
  - Gọi `IotAuditRepository.logDeviceCreation` trong cùng `EntityManager`.
  - Commit transaction nếu thành công, Rollback nếu bất cứ lỗi nào xảy ra.

## 8. Cập nhật IotModule
- [x] Cập nhật file `src/modules/iot/iot.module.ts`.
- [x] Import `TypeOrmModule.forFeature([IotDevice])`.
- [x] Khai báo `IotDevicesController` trong `controllers` array.
- [x] Khai báo `IotDevicesService` và `IotAuditRepository` trong `providers` array.

## 9. Controller
- [x] Tạo hoặc cập nhật `src/modules/iot/controllers/iot-devices.controller.ts`.
- [x] Khai báo method `POST /api/v1/iot-devices`.
- [x] Decorate endpoint với Auth Guard và Permission Guard (`iot_devices:create`). Không hard-code role.
- [x] Nếu `ValidationPipe` không map đúng tên biến sang camelCase, thêm logic map thủ công tại đây trước khi gọi service.
- [x] Gọi `IotDevicesService.create(req.user.id, mappedDto)`.
- [x] Trả về kết quả qua hàm `toIotDeviceResponse(...)`.

## 10. Tests
- [x] Unit test `IotDevicesService.create` happy path (đảm bảo transaction & audit đc gọi).
- [x] Unit test duplicate `device_code` -> throw `DEVICE_CODE_EXISTS`.
- [x] Unit test duplicate `mac_address` -> throw `MAC_ADDRESS_EXISTS`.
- [x] Unit test trùng IP nhưng không trùng MAC/code -> Success.
- [x] Unit test response metadata bị mask.
- [x] Viết e2e test / controller test (hoặc contract test) cho `POST /api/v1/iot-devices` (nếu project có setup). Test case 403 nếu thiếu permission.

## 11. Final Verification
- [x] Chạy linter toàn project (`npm run lint` hoặc tương đương).
- [x] Chạy toàn bộ test (`npm run test` hoặc tương đương).
- [x] Chạy build project (`npm run build` hoặc tương đương) để xác nhận không lỗi Type.
- [x] Cập nhật kết quả vào Checkbox file này và Walkthrough artifact.
