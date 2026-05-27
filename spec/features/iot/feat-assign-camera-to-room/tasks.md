# Tasks: Gán camera vào phòng họp (IOT-002)

## 1. Kiểm tra codebase hiện tại
- [x] Kiểm tra `IotDevice` entity hiện có trong `src/modules/iot/entities/iot-device.entity.ts`.
- [x] Kiểm tra bảng/migration `iot_devices` hiện đã có cột `room_id` chưa trong `src/database/migrations/`.
- [x] Kiểm tra project đã có `RoomEntity`, `RoomsService`, hoặc repository/query convention cho bảng `rooms` chưa (để validate room tồn tại).
- [x] Kiểm tra `IotAuditRepository` hiện có hàm ghi audit nào từ UC1 trong `src/modules/iot/repositories/iot-audit.repository.ts`.
- [x] Kiểm tra controller/service hiện tại của module `iot` (như `iot-devices.controller.ts`, `iot-devices.service.ts`).
- [x] Kiểm tra convention error/exception hiện tại của dự án.

## 2. Migration / Entity update
- [x] Nếu `iot_devices.room_id` chưa tồn tại, tạo migration bổ sung cột `room_id uuid null`. KHÔNG thêm FK sang `rooms` nếu baseline hiện tại không yêu cầu hoặc nếu convention DB đã bỏ FK phức tạp.
- [x] Cập nhật entity `IotDevice` trong `src/modules/iot/entities/iot-device.entity.ts`:
  - Thêm `roomId: string | null`
  - Map với column `room_id` (`@Column({ name: 'room_id', type: 'uuid', nullable: true })`).
- [x] Đảm bảo KHÔNG thêm `equipment_id`.

## 3. DTO
- [x] Tạo file `AssignRoomDto` ở `src/modules/iot/dto/assign-room.dto.ts`.
- [x] Khai báo biến `room_id` (sử dụng snake_case).
- [x] Validate `room_id` bằng `@IsUUID()` và `@IsNotEmpty()`.
- [x] Thêm `@Expose({ name: 'room_id' })` nếu project dùng class-transformer hoặc mapping thủ công tương tự UC1.

## 4. Service
- [x] Cập nhật file `src/modules/iot/services/iot-devices.service.ts`.
- [x] Tạo method `assignRoom(userId: string, deviceId: string, dto: AssignRoomDto)`.
- [x] Validate device tồn tại: fetch `IotDevice` theo `deviceId`. Trả `NotFoundException('IOT_DEVICE_NOT_FOUND')` nếu không có.
- [x] Validate trạng thái device: KHÔNG cho assign nếu device disabled/inactive/deleted theo convention hiện có. CHO PHÉP assign khi device offline.
- [x] Validate loại device: Chỉ cho phép `door_face_terminal`, `ip_room_camera`, `room_camera`. Trả lỗi nghiệp vụ `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM` nếu không hợp lệ.
- [x] Validate room tồn tại: fetch room từ `rooms` table. Trả `NotFoundException('ROOM_NOT_FOUND')` nếu không có.
- [x] Validate trạng thái room: KHÔNG cho assign nếu room disabled/inactive/deleted theo convention hiện có.
- [x] Xử lý Same-room Idempotent: Nếu `device.roomId === dto.room_id`, return 200 OK ngay lập tức (không update DB, không ghi audit log).
- [x] Xử lý Conflict: Nếu `device.roomId` khác null và khác `dto.room_id`, ném `ConflictException('DEVICE_ALREADY_ASSIGNED_TO_ROOM')`.
- [x] Nếu device chưa có room, chuẩn bị logic update `room_id`.

## 5. Audit
- [x] Cập nhật file `src/modules/iot/repositories/iot-audit.repository.ts`.
- [x] Bổ sung hàm `logAssignRoom(manager: EntityManager, data: { userId: string, deviceId: string, oldRoomId: string | null, newRoomId: string })`.
- [x] Lệnh ghi vào `audit_logs`:
  - `user_id = userId`
  - `action_type = 'assign_room'`
  - `entity_type = 'iot_devices'`
  - `entity_id = deviceId`
  - `metadata` chứa `{ old_room_id, new_room_id }`
  - `severity = 'info'`

## 6. Transaction
- [x] Trong `assignRoom` (của `IotDevicesService`), bọc luồng update vào transaction bằng TypeORM `QueryRunner` hoặc `EntityManager`.
- [x] Thực hiện update `iot_devices.room_id` bằng transaction manager.
- [x] Gọi hàm `logAssignRoom` bằng transaction manager.
- [x] Try/catch và `rollbackTransaction()` nếu xảy ra lỗi ghi audit log hoặc update room assignment.
- [x] Đảm bảo với trường hợp Idempotent (same-room) thì không mở transaction vì không cần update.

## 7. Controller
- [x] Cập nhật file `src/modules/iot/controllers/iot-devices.controller.ts`.
- [x] Khai báo endpoint `POST /api/v1/iot-devices/:id/assign-room`.
- [x] Thêm Guard xác thực JWT.
- [x] Thêm decorator `@Permissions('iot_devices:assign_room')` (KHÔNG hard-code role Admin/Manager).
- [x] Validate param `:id` bằng `ParseUUIDPipe` hoặc convention tương đương.
- [x] Gọi `IotDevicesService.assignRoom(req.user.userId, id, dto)` (sử dụng mapping userId thích hợp).
- [x] Trả response qua `toIotDeviceResponse` hoặc response mapper hiện có.

## 8. Tests
- [x] Unit test (Service - Happy path): update `room_id` và audit được ghi trong transaction.
- [x] Unit test (Service - Rollback): Rollback dữ liệu nếu gọi audit log lỗi.
- [x] Unit test (Service - Device Not Found): Trả `IOT_DEVICE_NOT_FOUND`.
- [x] Unit test (Service - Room Not Found): Trả `ROOM_NOT_FOUND`.
- [x] Unit test (Service - Invalid Device Type): Trả `DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM`.
- [x] Unit test (Service - Conflict Assign): Thiết bị đã gán phòng khác -> `DEVICE_ALREADY_ASSIGNED_TO_ROOM`.
- [x] Unit test (Service - Idempotent): Same-room assignment -> 200 OK, không update, không audit.
- [x] Unit test (Service - Offline): Device offline vẫn assign được.
- [x] Unit/Controller/E2E test (Auth): Thiếu permission -> trả 403 Forbidden (nếu project có setup).

## 9. Final verification
- [x] Chạy linter: `npm run lint` (hoặc command tương đương).
- [x] Chạy test: `npm run test` (hoặc command tương đương).
- [x] Chạy build: `npm run build` (hoặc command tương đương).
- [x] Nếu không chạy được, ghi rõ lý do và command cần chạy.
