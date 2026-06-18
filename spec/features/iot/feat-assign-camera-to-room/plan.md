# Implementation Plan: Gán camera vào phòng họp (IOT-002)

## 1. Technical Context
- **Framework**: NestJS
- **Database**: PostgreSQL
- **ORM**: TypeORM (sử dụng QueryRunner/EntityManager để xử lý transaction)
- **Module**: `iot` (`IotModule`)
- **Entities**: Bảng `iot_devices` và `audit_logs` (thao tác trực tiếp từ backend)
- **Thiết kế cốt lõi**:
  - Không sinh thêm bảng phụ `device_room_assignments`. Nguồn dữ liệu (source of truth) dựa vào `room_id` trên `iot_devices`.
  - Không sử dụng MQTT/Mosquitto, không xử lý IVSS, không giao tiếp Face Server, không có RTSP stream/media server tích hợp trong luồng API này.
  - Không thao tác lên bảng `equipments`.

## 2. Data Model / Entity Affected
- **`IotDevice` Entity** (`src/modules/iot/entities/iot-device.entity.ts`):
  - Cập nhật trường `room_id`. Đảm bảo nó được liên kết đúng chuẩn (không bắt buộc tạo FK vật lý nếu convention cấm, nhưng phải là data logic UUID chuẩn).
- **`IotAuditRepository`** (`src/modules/iot/repositories/iot-audit.repository.ts`):
  - Bổ sung hàm ghi log cho hành động `assign_room` với entity_type `iot_devices`.

## 3. API Contract
- **Endpoint**: `POST /api/v1/iot-devices/:id/assign-room` (hoặc `/:device_id/assign-room`)
- **Method**: POST
- **Guard**: `JwtAuthGuard`, custom `PermissionsGuard` (nếu có)
- **Permission**: `iot_devices:assign_room`
- **Request Path Params**:
  - `id`: UUID (ID của IoT Device)
- **Request Body** (JSON):
  ```json
  {
    "room_id": "uuid"
  }
  ```
- **Response Success (200 OK)**:
  ```json
  {
    "success": true,
    "data": { ...IotDeviceResponseDto }
  }
  ```

## 4. DTO & Validation
- **`AssignRoomDto`**:
  - `@IsUUID()` và `@IsNotEmpty()` cho trường `room_id`.
- **Param Validation**:
  - `ParseUUIDPipe` cho tham số `:id` ở path URL.

## 5. Service Flow (`IotDevicesService.assignRoom`)
1. **Tìm kiếm thiết bị**: Query `iot_devices` bằng `deviceId`.
   - Nếu không có: ném `NotFoundException('IOT_DEVICE_NOT_FOUND')`.
2. **Kiểm tra trạng thái thiết bị**:
   - Nếu thiết bị đang bị xóa mềm (deleted), disabled hoặc inactive: từ chối gán (ném exception nghiệp vụ tương ứng).
   - *Lưu ý: Không yêu cầu thiết bị phải đang online.*
3. **Kiểm tra loại thiết bị (Device Type)**:
   - Nếu type không thuộc nhóm `['door_face_terminal', 'ip_room_camera', 'room_camera']`: ném lỗi `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM`.
4. **Kiểm tra Idempotent (Same-room check)**:
   - Nếu `device.room_id === roomId`: Trả về nguyên object `device` (return early), trả 200 OK, không update DB, không ghi audit log.
5. **Kiểm tra xung đột (Conflict check)**:
   - Nếu `device.room_id` đã có dữ liệu và khác với `roomId`: ném `ConflictException('DEVICE_ALREADY_ASSIGNED_TO_ROOM')`.
6. **Kiểm tra phòng**: Query `rooms` bằng `roomId` qua một service hoặc repository.
   - Nếu không có: ném `NotFoundException('ROOM_NOT_FOUND')`.
   - Nếu phòng đang bị deleted, inactive, hoặc disabled: từ chối gán.
7. **Thực thi Transaction (Cập nhật DB + Audit Log)**:
   - Bắt đầu transaction bằng TypeORM `QueryRunner`.
   - Lưu `room_id` mới vào `IotDevice`.
   - Chèn một record vào bảng `audit_logs` bằng `IotAuditRepository`.
   - Nếu quá trình chèn log thất bại, toàn bộ transaction sẽ bị rollback. Thiết bị sẽ không bị gán nhầm nếu không có log.
   - Commit transaction.
8. **Trả về kết quả**: Fetch lại data mới nhất và trả về client thông qua `IotDeviceResponseDto`.

## 6. Permission & Security
- API phải có cấu hình Auth Guard để lấy `req.user.userId`.
- Decorator `@Permissions('iot_devices:assign_room')` để block user thiếu quyền. Không hard-code các roles (Admin/Manager).

## 7. Transaction Strategy
- Dùng `this.dataSource.createQueryRunner()`:
  - `await queryRunner.connect(); await queryRunner.startTransaction();`
  - Thực hiện update và insert bằng `queryRunner.manager`.
  - `await queryRunner.commitTransaction();`
  - Wrap bằng `try { ... } catch (e) { await queryRunner.rollbackTransaction(); throw e; }`

## 8. Audit Strategy
- `action_type`: `'assign_room'`
- `entity_type`: `'iot_devices'`
- `entity_id`: `deviceId`
- `metadata`: `{ "old_room_id": <UUID cũ hoặc null>, "new_room_id": <UUID mới> }`
- `user_id`: UUID của người dùng từ token JWT.

## 9. Error Handling
- `400 Bad Request`: Validation lỗi trên DTO hoặc UUID param.
- `401 Unauthorized`: Lỗi xác thực token.
- `403 Forbidden`: Lỗi thiếu quyền `iot_devices:assign_room`.
- `404 Not Found`: `IOT_DEVICE_NOT_FOUND`, `ROOM_NOT_FOUND`.
- `409 Conflict`: `DEVICE_ALREADY_ASSIGNED_TO_ROOM`.
- `422 Unprocessable Entity`: (Tùy convention của Nest filter, có thể là 400 hoặc 422) cho lỗi `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM` hoặc thiết bị/phòng bị inactive.

## 10. Test Strategy
- **Unit Test Service (`assignRoom`)**:
  - Test case: Gán thành công (Verify commit, ghi audit log).
  - Test case: Rollback thành công nếu ghi log ném lỗi.
  - Test case: Ném `ConflictException` nếu `room_id` khác null và khác `roomId` mới.
  - Test case: Trả về thành công luôn nếu `room_id` trùng nhau, verify QueryRunner KHÔNG được gọi.
  - Test case: Ném exception nếu device type không hợp lệ.
  - Test case: Ném exception nếu thiết bị hoặc phòng không tồn tại/inactive.
- **Unit Test Controller / E2E (nếu có)**:
  - Verify route được bảo vệ bởi Guards.

## 11. Risks & Open Questions
- Không có open question. Mọi kịch bản (Conflict, Idempotent, Validation, Out of scope) đều đã được spec rõ ràng.
