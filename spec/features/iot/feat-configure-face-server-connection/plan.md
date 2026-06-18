# Implementation Plan: Cấu hình thông tin kết nối Face Server (IOT-003)

## 1. Technical Context
- **Module:** `iot`
- **Mục tiêu:** Cung cấp API để cấu hình kết nối mạng và callback path cho các thiết bị `door_face_terminal`. Tạo callback token dùng để thiết bị xác thực khi gọi ngược về hệ thống.
- **Quy tắc cốt lõi:** Không mở rộng scope (không làm RTSP, IVSS, Attendance, Face Server integration thực tế). Không lưu plain token trong database.

## 2. Data Model Affected
- **Table:** `iot_devices`
- Không tạo bảng mới hay migration mới, tái sử dụng schema hiện tại.
- **Field chịu ảnh hưởng:**
  - `metadata_json` (chứa configuration).
  - `updated_at`.
- Cấu trúc `metadata_json` sau khi update sẽ được merge an toàn, bảo tồn các cấu hình/key khác. Khối cấu hình được đặt dưới key `face_server_config`.

## 3. API Contract
**PATCH /api/v1/iot-devices/:id/face-server-config**

*Request Params:*
- `id` (UUID của thiết bị)

*Request Body:*
```json
{
  "callback_enabled": true,
  "callback_protocol": "http",
  "callback_base_url": "http://192.168.2.10:3000",
  "heartbeat_path": "/api/v1/device-callbacks/face/heartbeat",
  "verify_path": "/api/v1/device-callbacks/face/verify",
  "stranger_path": "/api/v1/device-callbacks/face/stranger",
  "allowed_source_ip": "192.168.2.20"
}
```

*Response:*
- Success (200 OK)
- Body chứa `IotDeviceResponseDto` cộng thêm `one_time_callback_token` để admin cấu hình vào thiết bị.

## 4. DTO Validation
Tạo file `src/modules/iot/dto/configure-face-server.dto.ts` với class-validator:
- `callback_enabled`: `@IsBoolean()`, `@IsOptional()`. (Quy định: Nếu không truyền, mặc định sẽ gán bằng `true`).
- `callback_protocol`: `@IsIn(['http', 'https'])`
- `callback_base_url`: `@IsUrl({ require_tld: false })`, `@IsOptional()`
- `allowed_source_ip`: `@IsIP()`, `@IsNotEmpty()`
- `heartbeat_path`, `verify_path`, `stranger_path`:
  - `@IsString()`, `@IsNotEmpty()`
  - `@Matches(/^\/[a-zA-Z0-9-_\/]+$/, { message: 'Must be a valid path starting with /' })`
  - *(Lưu ý: RegEx không cho phép domain http/https)*

## 5. Service Flow (`IotDevicesService.configureFaceServer`)
1. **Tìm thiết bị:** Truy vấn DB bằng `id`. Trả `NotFoundException` nếu không thấy.
2. **Kiểm tra Device Type:** Nếu khác `door_face_terminal`, ném `ConflictException(DEVICE_TYPE_NOT_FACE_SERVER)`.
3. **Kiểm tra Gán phòng:** Nếu `roomId` is null, ném `ConflictException(DEVICE_ROOM_ASSIGNMENT_REQUIRED)`.
4. **Sinh Token:** Gọi hàm tiện ích sinh plain token và hash.
5. **Chuẩn bị Dữ liệu Metadata:** Lấy `metadata_json` hiện tại, deep-merge (hoặc object assign/spread) để cập nhật key `face_server_config` gồm dữ liệu từ DTO và token hash, last4, generated_at.
6. **Transaction & Cập nhật `updated_at`:** 
   - `queryRunner.startTransaction()`
   - Thực hiện lưu vào database bằng `queryRunner.manager.save(IotDevice, device)`. Bằng cách thay đổi entity instance và gọi `save()`, TypeORM sẽ tự động cập nhật cột `updated_at` lên thời gian hiện tại (`now()`).
   - Gọi `iotAuditRepository.logConfigureFaceServer(queryRunner.manager, ...)`
   - `queryRunner.commitTransaction()`
7. **Trả kết quả:** Chèn `one_time_callback_token` (plain token) vào kết quả trả về, xoá/không gắn key hash.

## 6. Token Generation & Hash Strategy
Tái sử dụng các pattern mã hoá hiện có trong dự án (dựa trên module Auth):
- **Generate:** Dùng `crypto.randomBytes(32).toString('hex')` (hoặc base64) tạo chuỗi ngẫu nhiên ~64 ký tự.
- **Hash:** Dùng `crypto.createHash('sha256').update(plainToken).digest('hex')`. Phương pháp này nhanh, deterministic đủ tốt cho API Token và đã được sử dụng ở `password-reset.service.ts` cho mã OTP.
- **Lưu trữ:** Lưu hash vào `callback_token_hash`, trích xuất 4 ký tự cuối của plain token lưu vào `callback_token_last4`. Plain token chỉ trả ra controller.

## 7. Metadata Merge Strategy
Để tránh mất mát dữ liệu khi update cột JSONB:
```typescript
const currentMetadata = device.metadataJson || {};
const newFaceConfig = {
  ...dto,
  callback_token_hash: tokenHash,
  callback_token_last4: plainToken.slice(-4),
  configured_at: new Date().toISOString()
};
const updatedMetadata = {
  ...currentMetadata,
  face_server_config: newFaceConfig
};
```

## 8. Permission & Security / Response Mapper Security
- Tạo permission decorator trên controller: `@Permissions('iot_devices:configure_face_server')`.
- Sửa hàm mapper chung (`toIotDeviceResponse` trong `iot-device-response.dto.ts`) để **bắt buộc loại bỏ (delete/omit)** trường `callback_token_hash` khỏi `metadata_json.face_server_config` trước khi trả về.
- Plain token hay Hash tuyệt đối không được lộ. Rule này áp dụng chung cho API cấu hình IOT-003 và toàn bộ các API GET (list/detail) thiết bị sau này.

## 9. Transaction Strategy
Mọi thao tác thay đổi trạng thái (Update Device) và Ghi nhận (Insert Audit Log) phải qua `QueryRunner`. Nếu Log thất bại => Thiết bị không được lưu cấu hình => An toàn dữ liệu.

## 10. Audit Strategy
Thêm method `logConfigureFaceServer` vào `IotAuditRepository`:
- Tham số: `manager`, `userId`, `deviceId`, `configMetadata`.
- Lọc bỏ `one_time_callback_token` và `callback_token_hash` khỏi `configMetadata` trước khi lưu vào cột `metadata_json` của `audit_logs`.
- Ghi nhận với `action_type = configure_face_server` và `severity = info`.

## 11. Response Mapping
- Controller method sẽ trả về định dạng giống `IotDeviceResponseDto`, nhưng kèm theo field độc lập `one_time_callback_token`.
- Sẽ tạo interface hoặc local class `FaceServerConfigResponse` kế thừa `IotDeviceResponseDto` để map đúng kiểu trả về cho client.

## 12. Test Strategy
Tạo unit tests trong `iot-devices.service.spec.ts`:
- **Happy path:** Cấu hình đúng chuẩn, token được sinh, transaction chạy trơn tru, token cũ bị thay thế nếu re-config.
- **Validation Failed (Mock Controller level):** Test các payload không hợp lệ.
- **Business rule Failed:** Device không tồn tại, Device sai loại (khác door_face_terminal), Device chưa gán phòng.
- **Rollback:** Test audit_logs gặp lỗi DB và Transaction được rollback.

## 13. Risks / Open Questions
- Không còn Open Question nào. Rủi ro lộ lọt Token Hash ở API GET đã được giải quyết triệt để thông qua cơ chế Mapper chung.
- Sẵn sàng để implement khi được user xác nhận.

---

> [!IMPORTANT]
> User Review Required: Hãy xem xét Implementation Plan này. Nếu mọi thứ đúng như mong đợi, hãy xác nhận duyệt để tôi tạo `tasks.md` và bắt đầu triển khai mã nguồn!
