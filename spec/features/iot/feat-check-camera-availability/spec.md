---
name: "Feature Specification: Kiểm tra trạng thái khả dụng của camera"
description: "Đặc tả kỹ thuật (Spec) cho IOT-005: Kiểm tra trạng thái kết nối và cấu hình của IP Camera và Face Server."
version: "1.0"
date: "2026-06-01"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-01 | Khởi tạo spec.md dựa trên clarification answers của USER | Toàn bộ file |

# 1. Tổng quan (Overview)
Tính năng này (IOT-005) dùng để kiểm tra xem một camera (hoặc thiết bị IoT liên quan) có đang khả dụng để phục vụ các nghiệp vụ tiếp theo hay không. Hệ thống phân định 2 tầng kiểm tra:
1. **Runtime Availability**: Xác nhận thiết bị có đang online dựa trên tín hiệu heartbeat thực tế (áp dụng cho Face Server / Door Face Terminal).
2. **Config Readiness**: Xác nhận cấu hình cần thiết để thiết bị hoạt động đã sẵn sàng chưa (áp dụng cho IP Room Camera ở phiên bản MVP này).

Tính năng cung cấp Endpoint cho Frontend hoặc Admin Panel thực hiện chẩn đoán (diagnostic action), có side-effect lưu lại kết quả chẩn đoán vào database.

# 2. Phạm vi (Scope)
- **Thiết bị áp dụng**: Chỉ áp dụng cho `iot_devices` có `device_type` là `door_face_terminal` hoặc `ip_room_camera`.
- **Cập nhật dữ liệu**: Cập nhật `status`, `health_status`, `updated_at` và `metadata_json.last_availability_check` trong DB.
- **Bảo mật**: Không expose các secret như `rtsp_password`, `callback_token` ra payload của Response.
- **Audit Logging**: KHÔNG ghi audit log cho hành động check availability này trong MVP vì tính chất chẩn đoán gọi nhiều lần.

## Out of Scope
- Không thực hiện ping thiết bị bằng ICMP hay tạo HTTP/RTSP request trực tiếp đến thiết bị từ NestJS.
- Không có Python Camera Service tham gia probe runtime RTSP trong phiên bản này (Future extension).
- Không xử lý nghiệp vụ điểm danh, tracking người, nhận diện khuôn mặt.
- Không detect "No-show" hoặc tương tác với "Live Meeting".
- Không start/stop ghi hình.

# 3. Yêu cầu kỹ thuật (Technical Requirements)

## 3.1. Endpoint Design
- **Method & Route**: `POST /api/v1/iot-devices/:id/check-availability`
- **Path Param**: `id` là UUID của thiết bị trong bảng `iot_devices`.
- **Request Body**: None (không nhận payload trong phiên bản MVP này).
- **Headers**: Yêu cầu `Authorization: Bearer <token>`.
- **Phân quyền**: Yêu cầu có permission `iot_devices:check_availability` (Không hard-code check role Admin/Manager).

## 3.2. Logic Nghiệp vụ & Mapping Trạng thái
Việc check availability được thiết kế riêng rẽ dựa trên `device_type`.

### A. Đối với Face Server (`door_face_terminal`)
Kiểm tra dựa trên giá trị của trường `last_seen_at` (Heartbeat cuối cùng).
* **Threshold (ngưỡng)**: 5 phút.

| Tình trạng `last_seen_at` | `availability.is_available` | DB `status` | DB `health_status` | `availability.reason_code` | `availability.check_type` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Có <= 5 phút | `true` | `online` | `healthy` | `null` | `heartbeat_status` |
| Quá 5 phút | `false` | `offline` | `unhealthy` | `HEARTBEAT_STALE` | `heartbeat_status` |
| Bị `null` (Chưa từng thấy) | `false` | `offline` | `unknown` | `HEARTBEAT_NOT_SEEN` | `heartbeat_status` |

*Lưu ý: Trường hợp này `runtime_verified` = `true` trong metadata.*

### B. Đối với IP Room Camera (`ip_room_camera`)
Trong MVP hiện tại chỉ kiểm tra tính đầy đủ của cấu hình (Config Readiness). Không test connection thực tế.

| Điều kiện Check | `availability.is_available` | DB `status` | DB `health_status` | `availability.reason_code` |
| :--- | :--- | :--- | :--- | :--- |
| `room_id` bị thiếu | `false` | Giữ nguyên (thường `offline`) | `not_configured` | `DEVICE_ROOM_ASSIGNMENT_REQUIRED` |
| Thiếu `rtsp_config` | `false` | Giữ nguyên (thường `offline`) | `not_configured` | `RTSP_CONFIG_MISSING` |
| `rtsp_enabled = false` | `false` | Giữ nguyên (thường `offline`) | `not_configured` | `RTSP_DISABLED` |
| Có đủ RTSP Config* | `true` | Giữ nguyên (không set `online`) | `unknown` (nếu code chưa có `config_ready`) | `null` |

*(Đủ RTSP Config: Có `rtsp_host`, `rtsp_port`, `rtsp_path` hợp lệ).*
*Trường hợp này `check_type = rtsp_config_readiness` và `runtime_verified = false`. Thông báo trong response phải ghi rõ: `RTSP configuration is ready. Runtime stream probing is not performed in this version.`*
*Về giá trị `health_status`: Không tự ý thêm enum mới. Nếu codebase hiện chưa hỗ trợ giá trị `config_ready`, hãy dùng giá trị `unknown` và client sẽ phân biệt qua trường `metadata_json.last_availability_check.check_type`.*
*Về giá trị `status`: UC này không được set `status = online` chỉ vì config đầy đủ. Trạng thái online cần chứng minh được runtime.*

## 3.3. Database Updates
Cần có Transaction hoặc EntityManager khi update `iot_devices`.
Khi cập nhật `metadata_json.last_availability_check`, phải dùng phép gộp (merge) object thay vì ghi đè toàn bộ `metadata_json`. Tuyệt đối không xóa bỏ các metadata cũ đang tồn tại như `rtsp_config`, `face_server_config`, `vendor`, `connection` hay các field khác.

**Cấu trúc lưu kết quả trong `metadata_json.last_availability_check`:**
```json
{
  "last_availability_check": {
    "is_available": true,
    "check_type": "heartbeat_status", // hoặc "rtsp_config_readiness"
    "runtime_verified": true, // hoặc false
    "reason_code": null, // hoặc "HEARTBEAT_STALE"
    "message": "...", // Dòng thông báo tường minh
    "checked_at": "2026-06-01T10:00:00.000Z",
    "checked_by": "user_id_của_người_thực_hiện"
  }
}
```

## 3.4. Response Contract
Sử dụng chung mapper response logic từ các UC trước. Cấu trúc lồng `availability` trong payload `data`.
**Bảo mật:** Response không được expose `rtsp_password`, `rtsp_password_encrypted`, `callback_token`, `callback_token_hash`, hoặc bất kỳ secret/token/password nào trong `metadata_json`. Đồng thời, field `checked_by` chỉ lưu ở DB, KHÔNG được trả ra trong `availability` object của API response.
```json
{
  "success": true,
  "message": "Camera availability checked successfully",
  "data": {
    "id": "uuid",
    "device_code": "CAM-HL-01",
    "device_type": "ip_room_camera",
    "status": "offline",
    "health_status": "unknown",
    "metadata_json": { ... }, // Đã masked/filtered các field bảo mật
    "availability": {
      "is_available": true,
      "check_type": "rtsp_config_readiness",
      "runtime_verified": false,
      "reason_code": null,
      "message": "RTSP configuration is ready. Runtime stream probing is not performed in this version.",
      "checked_at": "2026-06-01T10:00:00.000Z"
    }
  }
}
```

# 4. Tiêu chí nghiệm thu (Acceptance Criteria)
1. **Thiết bị không tồn tại**: API trả về mã lỗi 404 Not Found.
2. **Loại thiết bị không hợp lệ**: Trả về 409 Conflict với mã lỗi `DEVICE_TYPE_NOT_CAMERA` nếu check thiết bị không thuộc loại `door_face_terminal` hay `ip_room_camera`.
3. **Face Terminal Online**: Nếu có heartbeat trong vòng 5 phút, trả về available, `status = online`, `health_status = healthy`.
4. **Face Terminal Offline**: Nếu heartbeat trễ hơn 5 phút, trả về unavailable, `status = offline`, `health_status = unhealthy`.
5. **Face Terminal Chưa bao giờ On**: Chưa có heartbeat -> unavailable, reason `HEARTBEAT_NOT_SEEN`.
6. **IP Camera thiếu Room**: `reason = DEVICE_ROOM_ASSIGNMENT_REQUIRED`.
7. **IP Camera thiếu RTSP config**: `reason = RTSP_CONFIG_MISSING`.
8. **IP Camera có RTSP config nhưng disabled**: `reason = RTSP_DISABLED`.
9. **IP Camera chuẩn bị đủ config**: `is_available = true` với mức config readiness, `runtime_verified = false`. Thông báo phản hồi rõ ràng về việc chưa probe stream, giữ nguyên `status`.
10. **Bảo mật Response**: Response payload tuyệt đối không để lộ mật khẩu, mã hóa RTSP hay Callback token/hash.
11. **Giữ Metadata nguyên vẹn**: Sau khi call API, các block metadata cũ phải được merge, không bị xóa.
12. **Boundary Restrictions**: UC không mở rộng xử lý điểm danh hay start/stop record video, không call đến Python Service bằng code thật.
