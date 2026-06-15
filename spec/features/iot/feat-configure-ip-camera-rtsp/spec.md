---
name: "Cấu hình RTSP cho IP Camera góc phòng"
description: "Lưu cấu hình kết nối RTSP cho các IP Room Camera để phục vụ luồng ghi hình hoặc AI processing nội bộ."
version: "1.0"
date: "2026-05-29"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-29 | Khởi tạo spec dựa trên Clarification Answers từ USER | Toàn bộ file |

# Mục đích (Purpose)
UC IOT-004 (Cấu hình RTSP cho IP Camera góc phòng) cho phép thiết lập và cập nhật tham số kết nối RTSP của các camera chuyên biệt phục vụ giám sát và AI processing trong phòng họp. Cấu hình này sẽ được Python Camera Service hoặc các Worker xử lý Media truy xuất để lấy luồng Video/Audio (stream) về sau.

# Phạm vi (Scope)
- **In Scope:**
  - Định nghĩa endpoint để cập nhật `rtsp_config` cho một camera hiện có.
  - Phân quyền cập nhật với permission `iot_devices:configure_rtsp`.
  - Validate loại thiết bị (chỉ hỗ trợ `ip_room_camera` hoặc `room_camera`).
  - Đảm bảo thiết bị đã gán phòng (`room_id` != null) trước khi được phép cấu hình.
  - Lưu và merge cấu hình RTSP vào field `metadata_json` của thiết bị.
  - Che giấu (mask) trường password khỏi mọi response trả về cho Client.
  - Audit logging hành động cấu hình, đảm bảo tính nguyên vẹn dữ liệu thông qua Transaction.
- **Out of Scope:**
  - Không validate hoặc test khả năng kết nối/ping luồng RTSP (Sẽ xử lý ở UC test camera sau).
  - Không xử lý luồng Media/RTSP stream trực tiếp qua NestJS.
  - Không thực thi Face Server callback, heartbeat, hay điểm danh.
  - Không tạo Database Schema/Table mới.

# Yêu cầu nghiệp vụ (Business Requirements)
1. **Ràng buộc thiết bị:**
   - Phải là thiết bị thuộc loại `ip_room_camera` (hoặc `room_camera`). Không áp dụng cho `door_face_terminal`, `microphone`, v.v.
   - Thiết bị phải đang được phân bổ cho một phòng nhất định (`room_id` IS NOT NULL).
2. **Quản lý payload cấu hình:**
   - Hệ thống không nhận URL gộp dạng `rtsp://user:pass@host/path` nhằm giảm thiểu rủi ro rò rỉ password ra log, browser history. Thay vào đó, payload đầu vào phải phân rã rõ ràng: host, port, path, username, password.
3. **Bảo mật mật khẩu RTSP & Storage Rule (MVP):**
   - Nếu codebase chưa có encryption utility ổn định, hệ thống có thể lưu RTSP password thô trong `metadata_json.rtsp_config.rtsp_password` để Python Camera Service/recording worker dùng về sau. Lưu ý đây là technical debt/security improvement.
   - Nếu sau này có encryption, sẽ chuyển sang lưu `rtsp_password_encrypted`.
   - **Tuyệt đối không:** API Response mapper và DB Audit Log tuyệt đối không bao giờ được trả/log `rtsp_password` gốc.
   - **Không expose encrypted password:** Ngay cả khi dùng encryption, response cũng không được trả về `rtsp_password_encrypted`. Audit log không được lưu `rtsp_password` hay `rtsp_password_encrypted`.
   - Trong API Response, thay vì trả về mật khẩu, hệ thống nên dùng cờ an toàn `"rtsp_password_configured": true` để báo hiệu mật khẩu đã được cài đặt (nếu có). Hoặc nếu trả field `"rtsp_password": "***"`, phải tài liệu hoá rõ ràng đây chỉ là chuỗi hiển thị ảo (masked display field), không phải password thực tế.
4. **Cơ chế ghi đè và Re-config (Overwrite):**
   - Không lưu dạng danh sách (array) lịch sử RTSP URL. Mỗi lần config là ghi đè cấu hình hiện tại trong `rtsp_config`.
   - Nếu gọi API `PATCH` lại cấu hình RTSP và request **có** truyền `rtsp_password`, ghi đè password cũ.
   - Nếu gọi API `PATCH` lại cấu hình RTSP và request **không** truyền `rtsp_password`, giữ nguyên password cũ (nếu config cũ đã có). Không tự động xóa password cũ. Nếu cần xóa password sẽ làm UC/API riêng sau.
   - Lịch sử theo dõi sự thay đổi cấu hình sẽ được lưu trên `audit_logs` một cách riêng biệt.

# Yêu cầu kỹ thuật (Technical Requirements)

## 1. Thiết kế API
**Endpoint:** `PATCH /api/v1/iot-devices/:id/rtsp-config`
**Module:** `iot`
**Guard:** `JwtAuthGuard`, `PermissionsGuard`
**Permission:** `iot_devices:configure_rtsp`

### Request Payload (DTO)
- `rtsp_enabled` (boolean, optional, default: `true`): Bật/Tắt sử dụng luồng này.
- `rtsp_protocol` (string, enum `['rtsp', 'rtsps']`, required): Giao thức. Không nhận giao thức khác.
- `rtsp_host` (string, required): Địa chỉ IP hoặc hostname hợp lệ. Không được chứa protocol, username, password, port hoặc path. (Ví dụ: Không nhận full RTSP URL `rtsp://user:pass@host:port/path`).
- `rtsp_port` (number, optional, default `554`): Cổng mở RTSP. Phải nằm trong giới hạn cổng hợp lệ (1-65535).
- `rtsp_path` (string, required): Đường dẫn luồng, ví dụ `/Streaming/Channels/101`. Phải bắt đầu bằng `/`, không rỗng, và không chứa full URL/domain.
- `rtsp_username` (string, optional): Tên tài khoản kết nối RTSP.
- `rtsp_password` (string, optional): Mật khẩu kết nối. Có thể bỏ qua trong lần update sau nếu muốn giữ password cũ.
- `stream_profile` (string, optional, default `"main"`): Định dạng stream (main/sub).

### Response
Trả về entity `IotDevice` đã được update và loại bỏ (mask) các trường nhạy cảm trong `metadata_json.rtsp_config`. Mật khẩu RTSP thô hay mã hóa đều không xuất hiện.
```json
{
  "success": true,
  "message": "RTSP configuration updated successfully",
  "data": {
    "id": "uuid",
    "device_type": "ip_room_camera",
    "metadata_json": {
      "rtsp_config": {
        "rtsp_enabled": true,
        "rtsp_protocol": "rtsp",
        "rtsp_host": "192.168.1.50",
        "rtsp_port": 554,
        "rtsp_path": "/Streaming/Channels/101",
        "rtsp_username": "admin",
        "rtsp_password_configured": true, 
        "stream_profile": "main",
        "configured_at": "2026-05-29T..."
      }
    }
  }
}
```

## 2. Lưu trữ (Storage)
Lưu vào trường `metadata_json` của bản ghi tương ứng trong bảng `iot_devices` theo định dạng Key mới `rtsp_config`.

## 3. Quản lý Giao dịch (Transaction) & Audit
Mỗi thay đổi phải áp dụng Transaction (`QueryRunner`).
- **Entity `iot_devices`**: Update `metadata_json` (merge cấu hình cũ) và trigger cập nhật `updated_at`.
- **Entity `audit_logs`**:
  - `action_type`: `configure_rtsp`
  - `entity_type`: `iot_devices`
  - `entity_id`: `:id` (UUID của thiết bị)
  - `severity`: `info`
  - `metadata_json`: Chứa object cấu hình (host, port, path, profile...) nhưng TUYỆT ĐỐI XOÁ thuộc tính `rtsp_password` và `rtsp_password_encrypted`.
- **Rollback**: Nếu Audit gặp lỗi hệ thống, toàn bộ hành động cập nhật cấu hình thiết bị phải bị huỷ bỏ (rollback).

# Chấp nhận (Acceptance Criteria)
- [ ] Truyền payload hợp lệ sẽ cập nhật thành công cấu hình RTSP vào DB.
- [ ] Gửi request bằng device có loại `door_face_terminal` sẽ bị từ chối với lỗi `DEVICE_TYPE_NOT_RTSP_CAMERA`.
- [ ] Thiết bị chưa gán vào phòng sẽ bị từ chối với lỗi `DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
- [ ] Không thể lấy được thông tin password gốc từ kết quả của mọi API liên quan tới IoT device.
- [ ] Lịch sử cập nhật cấu hình được lưu tại bảng `audit_logs` hoàn chỉnh và không lộ password.
- [ ] Không có Test connection logic nào chạy ngầm trong UC này. Cấu hình được coi là "được lưu trữ" thay vì "đã chạy".
