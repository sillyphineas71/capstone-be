---
title: Lưu raw event từ thiết bị camera
feature_id: IOT-009
module: iot
---

# CLAUDE.md / AGENTS.md CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-03 | Cập nhật spec.md cho IOT-009: Làm rõ transaction boundary, error handling, tính immutable và Acceptance Criteria. | Toàn bộ file |

# Specification: Lưu raw event từ thiết bị camera (IOT-009)

## 1. Bối cảnh hệ thống
- Backend sử dụng NestJS, PostgreSQL, TypeORM.
- Database baseline đang sử dụng là bản v3.2 Compact (39 tables).
- Bảng `iot_device_events` đã tồn tại trong database baseline với mục đích lưu trữ các event thô (raw events) hoặc tổng hợp từ thiết bị IoT.
- Tính năng này đóng vai trò như một "Raw Event Inbox". Sau khi nhận được tín hiệu qua IOT-007 (Verify) và IOT-008 (Stranger), hệ thống sẽ cất giữ payload gốc đã mask an toàn vào `iot_device_events` trước khi tính năng IOT-010 xử lý (Normalize).

## 2. Mục tiêu
- Cung cấp một internal storage service dùng để lưu các raw events.
- Áp dụng ngay cho `face_verify` và `face_stranger`.
- Giữ vững cấu trúc Payload (Tolerant Ingestion), trích xuất file metadata, lọc bỏ file buffer/base64 nhằm tránh DB bloat.
- Xây dựng một luồng dữ liệu an toàn và bất biến một phần (immutable raw snapshot) ở giai đoạn tiếp nhận, là cơ sở dữ liệu gốc để tra cứu sau này.

## 3. Scope
### 3.1. In Scope (Trong phạm vi)
- Tạo Entity `IotDeviceEvent` map chính xác với bảng `iot_device_events` có sẵn trong Database (nếu codebase chưa có).
- Viết Internal Service `IotDeviceEventsService.storeRawEvent(...)` để xử lý và lưu data.
- Tích hợp `storeRawEvent` vào trong các API Callback của `IOT-007` (Verify Event) và `IOT-008` (Stranger Event).
- Lưu `face_verify` và `face_stranger` với `processed_status = 'received'`.
- Chạy chung Transaction trong bước xử lý của `receiveVerifyEvent` và `receiveStrangerEvent` (truyền `EntityManager` cho `storeRawEvent`) để nếu DB Raw fail thì toàn bộ callback trả về HTTP 500/Fail.
- Tính toán mã hash SHA-256 từ object sanitize lưu vào `payload_json.payload_hash`.
- Sanitize data (ẩn mã Token, Secret).

### 3.2. Out of Scope (Ngoài phạm vi)
- Không tạo bảng mới (`camera_raw_events`, `iot_raw_events`), không tạo TypeORM migration làm thay đổi schema DB.
- Không thêm column mới (kể cả column `payload_hash`).
- Không lưu `heartbeat` event theo mặc định (tránh đầy DB).
- Không normalize data (tạo Attendance, Presence, Room, No-show).
- Không expose Public/Admin API `GET /api/v1/iot-device-events`.
- Không tạo Unique constraint chống Duplicate.
- Không phát triển Background Cleanup Job trong MVP.

## 4. Storage Design
Sử dụng TypeORM Entity ánh xạ tới bảng `iot_device_events` với các trường:
- `id`: UUID (Primary Key).
- `device_id`: Cột liên kết từ bảng `iot_devices`.
- `room_id`: Cột liên kết từ bảng `iot_devices` tại thời điểm nhận event.
- `meeting_id`: null (chưa có nghiệp vụ trong UC này).
- `event_type`: Loại sự kiện (e.g. `face_verify`, `face_stranger`).
- `event_time`: Timestamp có Timezone. Ưu tiên lấy từ payload nếu parse được timestamp hợp lệ. Nếu payload không có hoặc invalid, dùng `received_at`. Không throw lỗi nếu timestamp payload invalid.
- `source_protocol`: e.g., `http`.
- `severity`: Định dạng độ nghiêm trọng (`info` cho `face_verify`, `warning` cho `face_stranger`).
- `payload_json`: Trường JSONB lưu lại Raw Payload (bao gồm cả `payload_hash`).
- `processed_status`: Luôn là `received`.
- `error_message`: null.
- `created_at`: Timestamp.

## 5. Cấu trúc Payload JSONB Đề Xuất (`payload_json`)
```json
{
  "raw_payload_sample": {
    "info": {
      "DeviceID": 1792832
    },
    "operator": "SnapPush",
    "truncated": true
  },
  "file_metadata": [
    {
      "fieldname": "image",
      "originalname": "snapshot.jpg",
      "mimetype": "image/jpeg",
      "size": 12345
    }
  ],
  "request_meta": {
    "source_ip": "192.168.2.3",
    "http_method": "POST",
    "content_type": "multipart/form-data",
    "content_length": "45678",
    "received_at": "2026-06-03T00:00:00.000Z"
  },
  "device_snapshot": {
    "device_code": "TEST-CAM-001",
    "device_type": "door_face_terminal",
    "room_id": "uuid-or-null"
  },
  "extracted_fields": {
    "stranger_id": null,
    "similarity": null,
    "event_time": "2026-06-03T00:00:00.000Z"
  },
  "payload_hash": "a82b9... (SHA-256)",
  "raw_event_version": 1,
  "stored_by_uc": "IOT-009"
}
```

## 6. Security, Integrity & Transaction Rules
- **Masking:** Bất kỳ giá trị nào trong `raw_payload_sample` có keyword (password, token, secret) phải qua `maskSensitiveMetadata()`. Không bao giờ lưu dạng plain text token.
- **Base64/File Truncation:** Không chứa `file.buffer`, binary image hoặc base64 image. Chỉ lưu metadata file.
- **Tính Immutable một phần:** `payload_json.raw_payload_sample`, `file_metadata`, `request_meta`, `device_snapshot`, `payload_hash` là raw data snapshot và không được phép bị sửa sau khi lưu. Tuy nhiên, record `iot_device_events` vẫn có thể được UC-010 cập nhật `processed_status` và `error_message` sau này.
- **Error Handling & Transaction Boundary:** 
  - `storeRawEvent` là internal service, nên nhận `EntityManager` từ caller (IOT-007/IOT-008) để insert trong cùng transaction. Không mở nested transaction không cần thiết.
  - Update `iot_devices` (metadata_json, last_seen_at) VÀ Insert `iot_device_events` bắt buộc chạy trong cùng 1 Transaction.
  - Nếu Insert raw event thất bại -> `storeRawEvent` phải throw error -> Rollback transaction -> API không được trả success giả -> Throw HTTP 500 Error. Camera sẽ nhận tín hiệu Fail và retry. Đảm bảo 100% không mất dữ liệu thầm lặng.

## 7. Workflow tích hợp
Tạo `IotDeviceEventsService.storeRawEvent(input, entityManager?)` với tham số đầu vào được gói gọn trong DTO/Interface nội bộ.

Luồng ví dụ trong IOT-008 `receiveStrangerEvent()`:
1. Xác thực Device Code, Token Hash, Source IP thành công.
2. Build stranger payload sample.
3. Mở Transaction.
4. Gọi `storeRawEvent({ event_type: 'face_stranger', ... }, entityManager)` để lưu Raw Event.
5. Update `metadata_json`, `last_seen_at`, `status` của thiết bị bằng `entityManager`.
6. Hoàn tất và trả HTTP 200/201 Success. 

## 8. Acceptance Criteria (AC)
- **AC-001:** Khi verify callback hợp lệ được xử lý, hệ thống insert 1 record vào `iot_device_events` với `event_type = face_verify`, `source_protocol = http`, `severity = info`, `processed_status = received`.
- **AC-002:** Khi stranger callback hợp lệ được xử lý, hệ thống insert 1 record vào `iot_device_events` với `event_type = face_stranger`, `source_protocol = http`, `severity = warning`, `processed_status = received`.
- **AC-003:** `payload_json.payload_hash` được lưu trong JSONB và không có cột DB mới nào được tạo.
- **AC-004:** `payload_json` không chứa plain callback token, password, secret.
- **AC-005:** Nếu event có file ảnh, `payload_json.file_metadata` chỉ chứa metadata file, không chứa `file.buffer`, binary image, hoặc base64 image.
- **AC-006:** Heartbeat callback không tạo record trong `iot_device_events`.
- **AC-007:** Nếu insert `iot_device_events` thất bại, toàn bộ transaction rollback và callback trả lỗi, không trả success giả.
- **AC-008:** Metadata cũ trong `iot_devices.metadata_json` không bị mất khi transaction thành công.
- **AC-009:** Nếu event time trong payload invalid, hệ thống dùng `received_at` làm `event_time` và không crash.
- **AC-010:** Không expose API `GET /api/v1/iot-device-events` trong UC này.
