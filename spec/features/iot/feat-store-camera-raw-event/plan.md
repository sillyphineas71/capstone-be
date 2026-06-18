---
title: Implementation Plan - Lưu raw event từ thiết bị camera
feature_id: IOT-009
module: iot
---

# CLAUDE.md / AGENTS.md CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-03 | Tạo plan.md cho IOT-009: Lưu raw event từ camera. | Toàn bộ file |

# Implementation Plan: Lưu raw event từ thiết bị camera (IOT-009)

## 1. Storage Design
- Dùng bảng có sẵn `iot_device_events` trong Database Baseline.
- **Không** tạo bảng mới (`camera_raw_events` hay `iot_raw_events`).
- Tạo TypeORM Entity nếu codebase chưa có:
  - File: `src/modules/iot/entities/iot-device-event.entity.ts`
- Entity chỉ ánh xạ (map) đúng bảng baseline, **không làm thay đổi schema**.
- Các cột cần map:
  - `id` (uuid, primary key)
  - `device_id` (uuid)
  - `room_id` (uuid, nullable)
  - `meeting_id` (uuid, nullable)
  - `event_type` (varchar)
  - `event_time` (timestamptz)
  - `source_protocol` (varchar)
  - `severity` (varchar)
  - `payload_json` (jsonb)
  - `processed_status` (varchar)
  - `error_message` (text, nullable)
  - `created_at` (timestamptz)

## 2. Module / Service Structure
- Cập nhật service hiện tại: `src/modules/iot/services/iot-device-events.service.ts` (Tạo mới nếu chưa tồn tại).
- Tạo method: `storeRawEvent(input, entityManager?)`
- Tính chất: Đây là **Internal Service**, không expose public API/controller riêng.
- File service này sẽ được đăng ký trong mảng `providers` của `iot.module.ts` (và export nếu cần).

## 3. Input của storeRawEvent
Service cần nhận 1 object (interface) với các thông tin tối thiểu sau:
- `device` (IotDevice entity)
- `eventType` ('face_verify' | 'face_stranger')
- `sourceProtocol` ('http')
- `severity` ('info' | 'warning')
- `receivedAt` (Date)
- `occurredAt` (Date - nếu parse được từ payload)
- `sourceIp` (string)
- `httpMethod` (string)
- `contentType` (string)
- `contentLength` (string/number)
- `rawPayloadSample` (object - đã mask)
- `fileMetadata` (array of objects)
- `extractedFields` (object)
- `storedByUc` (string - mặc định 'IOT-009')

## 4. Mapping vào iot_device_events
Method `storeRawEvent` thực hiện khởi tạo record:
- `device_id` = `device.id`
- `room_id` = `device.roomId` (hoặc null)
- `meeting_id` = `null` (chưa xử lý trong UC này)
- `event_type` = `face_verify` hoặc `face_stranger`
- `event_time` = Ưu tiên timestamp parse được từ payload (`occurredAt`). Nếu không có hoặc invalid thì fallback về `receivedAt`. Không throw error nếu timestamp invalid.
- `source_protocol` = `http`
- `severity` = `info` (với face_verify), `warning` (với face_stranger)
- `payload_json` = sanitized payload object
- `processed_status` = `received`
- `error_message` = `null`

## 5. Cấu trúc Payload JSON (`payload_json`)
Sẽ lưu theo cấu trúc:
```json
{
  "raw_payload_sample": {},
  "file_metadata": [],
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
  "extracted_fields": {},
  "payload_hash": "sha256_hash_here",
  "raw_event_version": 1,
  "stored_by_uc": "IOT-009"
}
```
**Lưu ý:** `payload_hash` bắt buộc nằm gọn trong `payload_json`. Tuyệt đối không thêm cột `payload_hash` trong schema DB.

## 6. Security & Sanitize
- Bắt buộc chạy qua `maskSensitiveMetadata()` trước khi ném vào `storeRawEvent`.
- **Không lưu** plain `callback_token`, secret hay password ở dạng plain text.
- **Không log** full callback URL (vì có token trên path param).
- **Không log** plain token.
- **Không lưu** `file.buffer`, binary image hay base64 image (xóa nó trước khi truyền đi).
- File ảnh chỉ lấy metadata: `fieldname`, `originalname`, `mimetype`, `size`.
- Text field dài phải truncate theo convention (vd: 2000 ký tự) như IOT-007, IOT-008.

## 7. Tính Payload Hash
- Tính mã băm bằng SHA-256 từ cục object đã được sanitize (không chứa plain token).
- Lưu vào `payload_json.payload_hash`.
- Hiện tại ở MVP **không** reject event trùng lặp, **không** tạo Unique constraint.

## 8. Transaction Boundary (Quan trọng)
- Hàm `storeRawEvent(input, entityManager?)` tiếp nhận biến `EntityManager` (optional).
- Khi caller (`receiveVerifyEvent` / `receiveStrangerEvent`) truyền xuống, phải dùng chung `entityManager` đó để insert `IotDeviceEvent`. **Không** tự ý mở thêm nested transaction bằng `this.dataSource.transaction`.
- Quá trình chạy:
  1. Validate thiết bị, token, IP (đã làm).
  2. Build payload sample, che thông tin (đã làm).
  3. Mở TransactionManager trong service caller (đã làm).
  4. Gọi `storeRawEvent(..., entityManager)`.
  5. Cập nhật `iot_devices` (lastSeenAt, status, metadata_json.last_verify...).
  6. Nếu Insert lỗi -> Transaction tự rollback -> Hàm ném lỗi HTTP 500 ra ngoài -> Không trả success giả -> Không update thiết bị.

## 9. Integration vào IOT-007
- Trong file `iot-devices.service.ts` > hàm `receiveVerifyEvent()`:
  - Bổ sung lệnh gọi `storeRawEvent({ eventType: 'face_verify', severity: 'info', sourceProtocol: 'http', ... }, entityManager)` vào ngay bên trong block transaction.
  - Vẫn giữ nguyên response contract hiện tại.
  - KHÔNG gọi hàm này trong luồng Heartbeat.

## 10. Integration vào IOT-008
- Trong file `iot-devices.service.ts` > hàm `receiveStrangerEvent()`:
  - Bổ sung lệnh gọi `storeRawEvent({ eventType: 'face_stranger', severity: 'warning', sourceProtocol: 'http', ... }, entityManager)` vào ngay bên trong block transaction.
  - Vẫn giữ nguyên response contract hiện tại.

## 11. Không lưu Heartbeat
- Đảm bảo trong `receiveHeartbeat()` KHÔNG gọi hàm `storeRawEvent`.
- Heartbeat vẫn tiếp tục chỉ update vào record của `iot_devices`. Việc debug heartbeat sẽ được tách riêng ra sau này nếu cần.

## 12. Mối quan hệ với IOT-010
- IOT-009 **không** làm nhiệm vụ chuẩn hóa (normalize). Nó chỉ lưu với cờ `processed_status = 'received'`.
- UC-010 ở bước sau sẽ vào quét các events có cờ `received` này và đổi sang `processed`, `ignored`, hoặc `failed`.

## 13. Test Strategy
- Kiểm thử tích hợp IOT-007 (Verify): Đảm bảo khi gửi request verify hợp lệ, 1 record `iot_device_events` sinh ra với type `face_verify`, severity `info`, protocol `http`, status `received`.
- Kiểm thử tích hợp IOT-008 (Stranger): Đảm bảo record có type `face_stranger`, severity `warning`, status `received`.
- Đảm bảo `payload_hash` luôn tồn tại trong JSONB.
- Xác nhận không có cột nào bị sinh thêm trong cấu trúc Database.
- Xác nhận không có `callback_token` hay password rò rỉ trong `payload_json`.
- Gửi event có hình ảnh dung lượng nhỏ -> Xác nhận DB không có `file.buffer` hay base64.
- Kiểm thử gửi Heartbeat -> Xác nhận bảng `iot_device_events` không tăng số lượng bản ghi.
- Kiểm thử bằng cách ép Insert Error -> Xác nhận transaction Rollback, DB thiết bị giữ nguyên dữ liệu cũ, API trả HTTP 500 (không trả success giả).
- Đẩy một `event_time` không hợp lệ -> Hệ thống chuyển qua dùng `receivedAt`, không bị crash.
- Dữ liệu cũ trong `iot_devices.metadata_json` không bị mất.
- Đảm bảo Endpoint `GET /api/v1/iot-device-events` không tồn tại (chưa Expose API). 
