---
name: "Implementation Plan: Kiểm tra trạng thái khả dụng của camera"
description: "Kế hoạch triển khai IOT-005: Kiểm tra trạng thái khả dụng của Face Server và IP Room Camera."
version: "1.0"
date: "2026-06-01"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-01 | Khởi tạo plan.md dựa trên đặc tả của IOT-005 | Toàn bộ file |

# 1. Tổng quan (Overview)
Kế hoạch này phác thảo cách thực hiện UC IOT-005 (Kiểm tra trạng thái khả dụng của camera). UC này nằm trong module `iot`, cung cấp endpoint `POST /api/v1/iot-devices/:id/check-availability` để thực hiện một "diagnostic action" - chẩn đoán trạng thái runtime (cho Face Server) hoặc cấu hình (cho IP Room Camera) và lưu kết quả vào metadata.

## User Review Required
> [!IMPORTANT]
> Plan này được tạo ra theo đúng Specification đã chốt. Hãy review kỹ phần **Database Update** và **Status Mapping** (phần 3.3) để đảm bảo không bị sai lệch với codebase hiện tại trước khi sinh `tasks.md`.

## Open Questions
- Codebase hiện tại của `health_status` đã có `unknown`, `healthy`, `unhealthy`, `not_configured` chưa? (Dựa trên Spec, sẽ fallback về `unknown` nếu chưa hỗ trợ giá trị `config_ready`).

# 2. Phân tích & Thiết kế (Analysis & Design)

## 2.1. Module & Dependencies
- **Module**: `iot`
- **Dependencies**: Không gọi external dependencies (Không MQTT, Không Python Service, Không FFMPEG). Sử dụng database queries/transactions chuẩn của module hiện tại.

## 2.2. DTO
Không yêu cầu Request Body (payload rỗng).
- Tận dụng `toIotDeviceResponse` đã có từ các UC trước, đảm bảo logic che giấu `rtsp_password`, `rtsp_password_encrypted`, `callback_token`, `callback_token_hash`.
- Cấu trúc Response sẽ tuân thủ việc lồng `availability` block vào bên trong object `data` trả về.

## 2.3. Controller (`iot-devices.controller.ts`)
- **Endpoint**: `@Post(':id/check-availability')`
- **Guard/Decorators**:
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)`
  - `@Permissions('iot_devices:check_availability')`
  - `@Param('id', ParseUUIDPipe)`
- **Xử lý**: Lấy `userId` từ token (`req.user.id`) truyền xuống Service. Trả kết quả mapping qua `toIotDeviceResponse`.

# 3. Chi tiết triển khai (Proposed Changes)

### 3.1. Controller Layer

#### [MODIFY] [iot-devices.controller.ts](file:///d:/capstone-be/src/modules/iot/controllers/iot-devices.controller.ts)
- Bổ sung method `checkAvailability` với `@Post(':id/check-availability')`.
- Gọi hàm tương ứng từ service `iotDevicesService.checkAvailability(...)`.

### 3.2. Service Layer

#### [MODIFY] [iot-devices.service.ts](file:///d:/capstone-be/src/modules/iot/services/iot-devices.service.ts)
- Bổ sung method `checkAvailability(userId: string, deviceId: string)`.
- **Validation**:
  1. Tìm thiết bị theo `deviceId`. Nếu không thấy ném `NotFoundException`.
  2. Kiểm tra `deviceType`. Nếu không phải `door_face_terminal` hay `ip_room_camera`, ném `ConflictException` kèm mã code `DEVICE_TYPE_NOT_CAMERA`.
- **Logic cho Door Face Terminal**:
  - Lấy thời gian hiện tại trừ đi `last_seen_at`.
  - Nếu `<= 5` phút: `status = 'online'`, `health_status = 'healthy'`, `reason_code = null`.
  - Nếu `> 5` phút: `status = 'offline'`, `health_status = 'unhealthy'`, `reason_code = 'HEARTBEAT_STALE'`.
  - Nếu `null`: `status = 'offline'`, `health_status = 'unknown'`, `reason_code = 'HEARTBEAT_NOT_SEEN'`.
  - Thiết lập `check_type = 'heartbeat_status'`, `runtime_verified = true`.
- **Logic cho IP Room Camera**:
  - Thiếu `room_id` -> `reason_code = 'DEVICE_ROOM_ASSIGNMENT_REQUIRED'`, `health_status = 'not_configured'`, `status` giữ nguyên.
  - Thiếu `metadata_json.rtsp_config` -> `reason_code = 'RTSP_CONFIG_MISSING'`, `health_status = 'not_configured'`, `status` giữ nguyên.
  - `rtsp_enabled == false` -> `reason_code = 'RTSP_DISABLED'`, `health_status = 'not_configured'`, `status` giữ nguyên.
  - Hợp lệ (`rtsp_host`, `rtsp_port`, `rtsp_path` tồn tại) -> `reason_code = null`, `health_status = 'unknown'`, `status` giữ nguyên.
  - Thiết lập `check_type = 'rtsp_config_readiness'`, `runtime_verified = false`. Message: `RTSP configuration is ready. Runtime stream probing is not performed in this version.`

### 3.3. Database Updates
Sử dụng `QueryRunner` hoặc cơ chế hiện có để cập nhật đồng bộ các trường của `IotDevice`.
- Update trực tiếp các properties: `status`, `healthStatus`, `updatedAt` (nếu manual, thường TypeORM tự xử lý khi `save()`).
- Tính toán và gộp (merge) object metadata mới:
  ```typescript
  device.metadataJson = {
    ...device.metadataJson,
    last_availability_check: {
      is_available,
      check_type,
      runtime_verified,
      reason_code,
      message,
      checked_at: new Date().toISOString(),
      checked_by: userId,
    }
  };
  ```
  *(Việc merge này đảm bảo bảo tồn `rtsp_config`, `face_server_config`, `vendor`...)*

### 3.4. Audit Repository
**[SKIP]**: Theo Spec, UC này là diagnostic, **KHÔNG** ghi bất kì Audit log nào xuống DB.

# 4. Kế hoạch kiểm thử (Verification Plan)

### Automated Tests (Unit Tests)
Sẽ được viết trong `iot-devices.service.spec.ts`.
1. Gọi API với Device không tồn tại -> Báo `NotFoundException`.
2. Gọi API với `deviceType` là Sensor -> Báo `ConflictException` (DEVICE_TYPE_NOT_CAMERA).
3. **Door Face Terminal**:
   - `last_seen_at` là 1 phút trước -> available, online, healthy.
   - `last_seen_at` là 10 phút trước -> unavailable, offline, unhealthy.
   - `last_seen_at` null -> unavailable, offline, unknown (HEARTBEAT_NOT_SEEN).
4. **IP Room Camera**:
   - Thiếu `roomId` -> DEVICE_ROOM_ASSIGNMENT_REQUIRED.
   - Thiếu RTSP config -> RTSP_CONFIG_MISSING.
   - RTSP disabled -> RTSP_DISABLED.
   - RTSP config đầy đủ hợp lệ -> `is_available = true`, `runtime_verified = false`. Status KHÔNG BỊ SET thành `online` mà giữ nguyên.
5. Kiểm tra metadata không bị xóa (Mock repository save check).
6. Mapper logic vẫn che được password/secret trong block `last_availability_check` và `rtsp_config` như các UC trước (thông qua Test Controller hoặc E2E).

### Kịch bản không cần test/Không liên quan
- Không test kết nối mạng đến Face Server.
- Không test Python Service / OpenCV FFmpeg probing.
- Không ghi Audit Log.
- Không test No-show, Recording, hay Attendance.
