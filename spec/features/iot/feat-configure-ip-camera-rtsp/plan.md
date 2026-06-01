---
name: "Implementation Plan: Cấu hình RTSP cho IP Camera góc phòng"
description: "Kế hoạch triển khai IOT-004: Lưu cấu hình kết nối RTSP cho IP Camera."
version: "1.0"
date: "2026-05-29"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-29 | Khởi tạo plan.md dựa trên yêu cầu của USER | Toàn bộ file |

# Mục tiêu
Triển khai tính năng cấu hình RTSP cho thiết bị `ip_room_camera` (IOT-004) nhằm lưu trữ các thông số kết nối một cách an toàn trên DB. Luồng cấu hình phải đảm bảo tách biệt các tham số kết nối, không lưu raw password trên response và audit log, và hoạt động tuân thủ cơ chế bảo mật đã thoả thuận ở mức MVP.

# 1. Module
Tính năng này được triển khai hoàn toàn trong module `iot`.

# 2. Endpoint
- **Method & Path:** `PATCH /api/v1/iot-devices/:id/rtsp-config`
- **Chức năng:** Cập nhật thông số RTSP cho thiết bị được chỉ định.

# 3. Phân quyền (Permission)
- Sử dụng permission `iot_devices:configure_rtsp` trên Controller.
- Không sử dụng hard-code role Admin hay Manager.

# 4. Device Validation (Ràng buộc Thiết bị)
- Thiết bị (`deviceId`) phải tồn tại trong database (nếu không trả `NotFoundException`).
- `device_type` phải là `ip_room_camera` (hoặc `room_camera` nếu có hỗ trợ trong codebase hiện tại). Các loại thiết bị khác sẽ bị từ chối với lỗi `DEVICE_TYPE_NOT_RTSP_CAMERA` (`ConflictException`).
- Bắt buộc `room_id` IS NOT NULL. Nếu thiết bị chưa gán phòng sẽ bị từ chối với lỗi `DEVICE_ROOM_ASSIGNMENT_REQUIRED` (`ConflictException`).

# 5. DTO Validation
Tạo mới DTO `ConfigureRtspDto` với các ràng buộc sau:
- `rtsp_enabled`: Optional boolean, giá trị default là `true`.
- `rtsp_protocol`: Bắt buộc, chỉ nhận `rtsp` hoặc `rtsps` (`@IsIn`).
- `rtsp_host`: Bắt buộc. Phải là IP hoặc hostname hợp lệ (`@IsIP` hoặc Regex bắt hostname). Từ chối full RTSP URL (không chứa protocol, username, password, port, path).
- `rtsp_port`: Optional number, mặc định là `554`, phải nằm trong khoảng hợp lệ 1–65535 (`@Min`, `@Max`).
- `rtsp_path`: Bắt buộc. Phải bắt đầu bằng `/`, không rỗng, và không chứa full URL/domain (`@Matches`).
- `rtsp_username`: Optional string.
- `rtsp_password`: Optional string.
- `stream_profile`: Optional string, default là `main`.

# 6. Password Storage & Security
- **MVP Technical Debt:** Tạm thời lưu trữ `rtsp_password` dạng raw trong `metadata_json.rtsp_config.rtsp_password` phục vụ Python Camera Service. (Nếu sau này có tiện ích mã hoá, sẽ đổi thành `rtsp_password_encrypted`).
- Không dùng hashing (SHA-256) cho mật khẩu vì Python Service cần truy xuất bản thô/đã giải mã để kết nối tới camera.
- **Security Rule:**
  - Không trả về raw `rtsp_password` (hay `rtsp_password_encrypted`) trong bất kỳ JSON response nào.
  - Audit log cũng KHÔNG lưu các chuỗi mật khẩu này.
  - Chỉ trả về cờ `"rtsp_password_configured": true/false` trong cấu trúc response của `rtsp_config` để phía frontend biết có mật khẩu hay chưa.

# 7. Re-config Behavior (Hành vi Ghi đè)
Khi client gửi yêu cầu `PATCH` lại:
- Nếu có thuộc tính `rtsp_password`: Tiến hành cập nhật đè mật khẩu cũ.
- Nếu không có thuộc tính `rtsp_password`: **Giữ nguyên** mật khẩu cũ (nếu đã có). Không tự động xoá.
- Việc chủ động xoá mật khẩu (nếu cần) sẽ nằm ở Use Case/API riêng trong tương lai.

# 8. Metadata Merge
- Dữ liệu cấu hình mới được lưu vào thuộc tính `rtsp_config` của cột `metadata_json`.
- Sử dụng Spread syntax (`...metadataJson`) để đảm bảo không ghi đè mất cấu hình của thiết bị khác (ví dụ `face_server_config`).
- Cấu hình mới sẽ overwrite hoàn toàn cấu hình RTSP cũ, không lưu dạng mảng lịch sử URL.

# 9. Audit Logging
Trong file `IotAuditRepository`, tạo method `logConfigureRtsp`:
- `action_type`: `configure_rtsp`
- `entity_type`: `iot_devices`
- `entity_id`: `id` của camera
- `severity`: `info`
- `metadata_json`: Log các tham số (host, port, path, user, protocol, stream_profile) nhưng **xoá/không chứa** `rtsp_password` hay `rtsp_password_encrypted`. Thay vào đó, lưu thêm `"rtsp_password_configured": true/false`.

# 10. Database Transaction
- Phải khởi tạo `QueryRunner` để quản lý giao dịch.
- Lưu trữ thay đổi vào Entity `IotDevice` (để tự động trigger `updated_at`).
- Chèn record vào `audit_logs` bằng repository mới tạo.
- Nằm chung một Transaction: Nếu audit thất bại -> Rollback toàn bộ tác vụ. Nếu thành công -> Commit.

# 11. Response Mapper Security
- Cập nhật hàm chung `toIotDeviceResponse` (trong `iot-device-response.dto.ts`):
  - Kiểm tra xem thiết bị có `rtsp_config` không.
  - Xoá triệt để các thuộc tính `rtsp_password` / `rtsp_password_encrypted` khỏi object trả về.
  - Áp dụng logic bổ sung thuộc tính boolean `"rtsp_password_configured": true/false` dựa trên việc có tồn tại thuộc tính mật khẩu trong DB hay không.
- Mapper này tự động áp dụng cho IOT-004 và toàn bộ API get/list/detail `iot_devices`.

# 12. Test Strategy
Plan test (dự kiến trong `iot-devices.service.spec.ts`) bao quát các kịch bản sau:
1. Happy path cấu hình thành công (đầy đủ các param hợp lệ).
2. Lỗi ném ra `ConflictException` nếu sai `device_type`.
3. Lỗi ném ra `ConflictException` nếu device có `room_id` bị null.
4. Payload DTO Validation thất bại nếu truyền full RTSP URL vào `rtsp_host`.
5. Payload DTO Validation thất bại nếu `rtsp_path` sai định dạng.
6. Payload DTO Validation thất bại nếu `rtsp_port` vượt mức 65535.
7. Hành vi Re-config (PATCH lần 2) có mật khẩu -> Overwrite mật khẩu.
8. Hành vi Re-config (PATCH lần 2) không có mật khẩu -> Mật khẩu cũ được bảo toàn.
9. Kiểm tra Mapper: Password bị mask và cờ `rtsp_password_configured` có hiển thị đúng.
10. Kiểm tra Audit Log: Đảm bảo payload gửi vào Audit không mang mật khẩu thực tế.
11. Kiểm tra Transaction Rollback: Nếu Insert log lỗi, toàn bộ thay đổi cấu hình RTSP không được Commit.
12. Đảm bảo không có code/kịch bản nào liên quan đến Test Connection trong UC này.

---
> [!IMPORTANT]
> Plan đã được tạo lập xong. Xin vui lòng Review. Tôi chưa khởi tạo `tasks.md` hay implement code ở bước này.
