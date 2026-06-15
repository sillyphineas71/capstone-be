# Implementation Plan: Receive Stranger Event from Face Server

**Branch**: `feat-receive-face-server-stranger-event` | **Date**: 2026-06-03 | **Spec**: [spec.md](spec.md)
**Input**: Yêu cầu chi tiết và `spec.md` từ IOT-008.

## Summary

Tính năng này cho phép Backend (NestJS) nhận các sự kiện phát hiện người lạ (Stranger event) từ thiết bị Face Server. Hệ thống sử dụng một điểm cuối API (endpoint) tuỳ biến có alias ngắn (`/sf/:deviceCode/:callbackToken`) nhằm khắc phục giới hạn độ dài URL của thiết bị cứng. Endpoint này sẽ xác thực yêu cầu dựa trên token, kiểm tra tính hợp lệ của thiết bị, cập nhật trạng thái hoạt động (online/healthy) và lưu lại mẫu payload (giới hạn 5 event gần nhất) vào `metadata_json` để phân tích nghiệp vụ sau này mà không làm ảnh hưởng tới các luồng khác như Verify.

## Technical Context

**Language/Version**: TypeScript / Node.js
**Primary Dependencies**: NestJS, TypeORM, PostgreSQL
**Storage**: PostgreSQL (`iot_devices` table)
**Testing**: Jest (Unit Test cho Controller và Service)
**Target Platform**: Backend Server
**Project Type**: Web API (IoT Integration)
**Constraints**: 
- Không dùng JWT guard hay PermissionsGuard.
- Payload `multipart/form-data` giới hạn tối đa 5MB mỗi file và 5 files, loại bỏ `file.buffer`.
- Không gọi Notification, Alert, Attendance, MQTT, IVSS, v.v.

## 1. Module & Controllers

- **Module**: Tính năng thuộc module `iot`.
- **Canonical Controller**:
  - Tên: `DeviceCallbacksController` (prefix `device-callbacks`).
  - Hỗ trợ: `GET /api/v1/device-callbacks/face/stranger` và `POST /api/v1/device-callbacks/face/stranger`.
- **Short Alias Controller**:
  - Tạo mới: `stranger-short-device-callbacks.controller.ts`.
  - Prefix: `@Controller('sf')`.
  - Hỗ trợ: `GET /api/v1/sf/:deviceCode/:callbackToken` và `POST /api/v1/sf/:deviceCode/:callbackToken`.
  - Không nhầm lẫn với route của verify (`/vf`) hay heartbeat (`/hb`).
- **Lưu ý**: Cả 2 Controller chỉ làm nhiệm vụ map endpoint và parse param/body, sau đó gọi chung một service method. Không copy-paste logic nghiệp vụ (business logic duplicate). Không áp dụng `@UseGuards(JwtAuthGuard, PermissionsGuard)` cho các endpoint này.

## 2. Hardware Configuration

- **Stranger Subscription**: Thiết bị dùng `Subscription Snap`.
- **Cấu hình trên Face Server**:
  - Service Address: `192.168.2.2`
  - Service Port: `3000`
  - Stranger Subscription: `Subscription Snap`
  - Snap URL: `/api/v1/sf/TEST-CAM-001/<short_token>`
  - Không sử dụng các tham số query params (như `?d=...&t=...`) để tránh lỗi mất param từ phía thiết bị.

## 3. Service Structure

- **Service Class**: `IotDevicesService`.
- **Method Mới**: Tạo hàm `receiveStrangerEvent(input)` chuyên biệt xử lý riêng Stranger Event để dễ mở rộng luồng Security Alert sau này.
- **Tái sử dụng Helper**: Trích xuất (extract value), chuẩn hoá (normalize array/string), kiểm tra hash token, kiểm tra IP, che giấu dữ liệu nhạy cảm (masking), build file metadata, truncate payload... sẽ sử dụng lại từ luồng IOT-006/IOT-007 (có thể refactor thành private method dùng chung nếu chưa có). Không copy-paste lệch logic.

## 4. Trích xuất `device_code`

Thứ tự ưu tiên lấy `device_code` từ Request:
1. Header `X-Device-Code`
2. Body JSON `device_code`
3. Query param `device_code`
4. Query param `d`
5. Path param `deviceCode`

Nếu không tìm thấy hoặc rỗng -> Ném lỗi `400 DEVICE_CODE_REQUIRED`.

## 5. Trích xuất `callback_token`

Thứ tự ưu tiên lấy `callback_token` từ Request:
1. Header `X-Callback-Token`
2. Body JSON `callback_token`
3. Query param `callback_token`
4. Query param `t`
5. Path param `callbackToken`

Nếu không tìm thấy hoặc rỗng -> Ném lỗi `401 CALLBACK_TOKEN_REQUIRED`.
*Quy tắc bảo mật:* Không log URL gốc (vì chứa token), không log plain token, không lưu plain token vào DB.

## 6. Validation Flow

Quá trình kiểm tra tính hợp lệ trong Service:
1. Tìm thiết bị trong DB theo `device_code`. Nếu không có -> `404 IOT_DEVICE_NOT_FOUND`.
2. Kiểm tra `device_type === 'door_face_terminal'`. Nếu sai -> `409 DEVICE_TYPE_NOT_FACE_SERVER`.
3. Kiểm tra `metadata_json.face_server_config.callback_enabled === true`. Nếu sai -> `409 FACE_CALLBACK_NOT_ENABLED`.
4. Kiểm tra sự tồn tại của `callback_token_hash`. Nếu thiếu -> `409 CALLBACK_TOKEN_NOT_CONFIGURED`.
5. Hash `callback_token` (SHA-256) và so sánh với hash trong DB. Nếu sai -> `401 INVALID_CALLBACK_TOKEN`.
6. Kiểm tra IP (Source IP) theo kiểu best-effort nếu `allowed_source_ip` có cấu hình. Nếu không khớp -> `403 SOURCE_IP_NOT_ALLOWED`.
7. Tiến hành xử lý Stranger payload nếu pass tất cả các bước.

## 7. Payload Handling (Tolerant Ingestion)

Xử lý chấp nhận các định dạng Body linh hoạt (JSON, form-data, multipart/form-data, rỗng, raw text):
- Dùng `AnyFilesInterceptor` tại Controller đối với `POST` cho định dạng multipart.
- Giới hạn tải file: `fileSize = 5 * 1024 * 1024` (5MB), `files = 5`.
- Nếu vượt quá -> NestJS tự ném lỗi `413 Payload Too Large`.
- Nếu có đính kèm file ảnh, tuyệt đối không lưu `file.buffer`, không lưu binary/base64 vào `metadata_json` và không lưu vào Storage.
- Chỉ thu thập siêu dữ liệu file: `fieldname`, `originalname`, `mimetype`, `size`.
- Nếu payload hoàn toàn không parse được (hoặc body rỗng), hệ thống không crash mà vẫn tạo sample tối thiểu (chứa `content_type`, `content_length`, `method`, `source_ip`, `received_at`).

## 8. Build Stranger Payload Sample

Cấu trúc mẫu (Sample):
- Tổng hợp `raw_payload_sample` từ các trường văn bản, thông tin metadata của file và metadata của Request.
- Chạy hàm `maskSensitiveMetadata()` trước khi gán để che các mật khẩu, secret, token nếu vô tình xuất hiện.
- Truncate (Cắt gọn) trường văn bản nếu độ dài > 2000 kí tự và gán `truncated: true`.
- Thử trích xuất các trường logic (nếu tìm thấy trong raw payload): `stranger_id`, `event_time`, `capture_time`, `similarity`.
- Gắn mặc định `event_result = 'stranger'`.
- Nếu không extract được, để null/undefined thay vì báo lỗi.

## 9. DB Update

Khi validation hoàn thành và mẫu đã được build:
- Cập nhật thông tin online: `last_seen_at = now`, `status = 'online'`, `health_status = 'healthy'`.
- Cập nhật Data Mẫu (Merge chứ không replace):
  - Gắn mẫu mới vào `metadata_json.last_stranger_event_sample`.
  - Cập nhật `metadata_json.recent_stranger_event_samples` thành mảng mới, chèn mẫu vừa tạo vào vị trí `index 0` và dùng `.slice(0, 5)` để giữ lại 5 mẫu gần nhất.
- Giữ nguyên các metadata khác: `face_server_config`, `last_heartbeat`, `last_verify_event_sample`, v.v...
- Không tạo record ở bảng khác, không ghi audit log.

## 10. Response Contract

**Thành công (200 / 201):**
```json
{
  "success": true,
  "message": "Stranger event received successfully",
  "data": {
    "device_code": "TEST-CAM-001",
    "event_type": "face_stranger",
    "received_at": "2026-06-03T00:00:00.000Z"
  }
}
```
**Cam kết bảo mật Response:** Tuyệt đối không chứa `callback_token`, hash token, mật khẩu RTSP hay chuỗi nhị phân hình ảnh.

## 11. Transaction / Database Update

- Cập nhật DB qua TypeORM Repositories hoặc EntityManager (tuỳ convention hiện hành của dự án).
- Nếu gặp lỗi DB Update, phải quăng ngoại lệ để middleware trả lỗi 500, tuyệt đối không giấu lỗi trả về HTTP 200 giả mạo.

## 12. Test Strategy

Kiểm thử (Unit / Integration nếu có) bao phủ các khía cạnh:
1. Endpoint `GET /api/v1/sf/:deviceCode/:callbackToken` thành công.
2. Endpoint `POST /api/v1/sf/:deviceCode/:callbackToken` thành công.
3. Canonical Route `GET/POST /api/v1/device-callbacks/face/stranger` thành công.
4. Trích xuất thành công Token/Device code từ Header, Body, Path, Query.
5. Path/Header có đủ token nhưng Body JSON rỗng -> thành công không crash.
6. Body định dạng form-data, multipart/form-data không crash.
7. File vượt quá 5MB ném lỗi `413 Payload Too Large`.
8. Validation Failures: Missing Device Code (`400`), Không tìm thấy thiết bị (`404`), Sai loại thiết bị (`409`), Callback chưa bật (`409`), Thiếu Config Hash (`409`), Thiếu Token (`401`), Sai Token (`401`), Sai Source IP (`403`).
9. Cập nhật dữ liệu chính xác: `status` đổi thành `online`, chèn đủ 5 items vào `recent_stranger_event_samples` với item mới ở đầu. Các metadata cấu hình cũ không bị xoá đè.
10. Payload Sample không lưu `file.buffer`, base64 image, không rò rỉ token. Không tạo bảng ngoài lề. Không log sai quy định.
