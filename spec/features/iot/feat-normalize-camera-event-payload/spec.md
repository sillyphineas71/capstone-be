---
id: IOT-010
title: Chuẩn hóa payload sự kiện camera
module: iot
status: draft
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-03 | Khởi tạo Spec chuẩn hóa sự kiện IOT-010 | Toàn bộ file |
| 2026-06-03 | Cập nhật AC (sửa tên cột) và bổ sung rule batch/idempotency | Mục 5.7, 5.8, 6 |

# Mục tiêu & Giá trị (Feature Specification)

## 1. Bối cảnh
Các thiết bị nhận diện khuôn mặt (Face Server, Camera) từ các nhà cung cấp hoặc OEM khác nhau thường gửi payload sự kiện (`face_verify`, `face_stranger`) dưới định dạng không đồng nhất. Dữ liệu này hiện tại đang được lưu thô ở trạng thái gốc tại bảng `iot_device_events` (theo IOT-009). 
Để hệ thống có thể phân tích, tính toán điểm danh hoặc tạo cảnh báo sau này (IOT-011, IOT-012), chúng ta cần một lớp "Anti-Corruption Layer" (Lớp chống tham nhũng dữ liệu) để chuẩn hóa, bóc tách các trường rắc rối từ raw payload thành một cấu trúc duy nhất, độc lập với thiết bị.

## 2. Mục tiêu
Chuẩn hóa payload sự kiện camera thành dạng tiêu chuẩn `normalized_event`.
*   Cập nhật thông tin chuẩn hóa vào trực tiếp trường `payload_json.normalized_event` trong cùng bảng `iot_device_events`.
*   Đánh dấu trạng thái `processed_status` để thông báo cho các worker/processor ở bước sau.
*   Cung cấp tính năng chịu lỗi (Tolerant Extraction) để linh hoạt dò tìm Alias (tên trường) khác nhau.

## 3. Phạm vi (Scope)

### 3.1. In Scope
- Đọc record trong `iot_device_events` có `processed_status = 'received'` và `event_type IN ('face_verify', 'face_stranger')`.
- Parse thông tin từ `payload_json.raw_payload_sample` (và tham khảo `payload_json.extracted_fields`).
- Khởi tạo object `payload_json.normalized_event`.
- Cập nhật trạng thái `processed_status`:
    - `processed`: Nếu chuẩn hóa thành công.
    - `ignored`: Nếu event type không hỗ trợ hoặc payload rỗng/không mang ý nghĩa nghiệp vụ (không phải do lỗi code).
    - `failed`: Nếu gặp lỗi kỹ thuật trong lúc parse, cập nhật `error_message`.
- Hỗ trợ dò tìm sâu (Nested Object Extraction) cho các trường mã định danh.

### 3.2. Out of Scope
- Không tạo các bản ghi điểm danh (`attendance_records`, `attendance_events`, check-in/out).
- Không map user (`device_user_mappings`). 
- Không tạo thông báo (Notification) hay cảnh báo an ninh (Security Alert).
- Không xử lý detect no-show.
- Không nhận dạng khuôn mặt (Face Recognition) backend.
- Không gọi IVSS/IP camera SDK, không xử lý Python Camera Service.
- Không chuẩn hóa sự kiện `heartbeat`.
- Không tạo bảng mới, không chạy migration sửa Schema DB.
- Không expose bất kỳ REST API Endpoint nào (Không có GET/POST list hoặc debug).

## 4. Quyết định Kiến trúc & Integration Mode
- **Internal Service Mode**: Chạy nội bộ thông qua các hàm như `normalizeRawEvent(rawEventId)` và `normalizePendingRawEvents(limit)`. Không mở API.
- **Tách rời luồng Callback**: Không chạy đồng bộ ngay trong transaction nhận Callback IOT-007/008. IOT-009 sẽ ghi nhanh raw, và IOT-010 chạy tách biệt sau đó để bảo vệ độ trễ API.
- **Không có Queue/Cronjob**: Tạm thời chưa triển khai Background Worker hay Queue. Chỉ tạo hàm và test để module nghiệp vụ này vững chãi trước khi ghép tời Scheduler sau.

## 5. Yêu cầu kỹ thuật chi tiết

### 5.1. Bất biến Dữ liệu Gốc (Immutability)
Tuyệt đối không sửa hay xóa các thuộc tính gốc đã được hệ thống lưu trữ bởi IOT-009:
- `payload_json.raw_payload_sample`
- `payload_json.file_metadata`
- `payload_json.request_meta`
- `payload_json.device_snapshot`
- `payload_json.payload_hash`

Chỉ thao tác Merge thêm property `normalized_event` vào `payload_json`.

### 5.2. Tolerant Field Extraction (Khả năng chịu lỗi Alias)
Do khác biệt Vendor, hệ thống cần quét các khoá tiềm năng theo thứ tự ưu tiên (cả flat object và nested object). Nếu không tìm thấy, đặt bằng `null` chứ không quăng exception.

- **Person ID**: `person_id`, `personId`, `PersonID`, `UserID`, `user_id`, `EmployeeID`, `employee_id`, `card_no`, `CardNo`, `id` (hoặc chui vào `data.person.id`).
- **Person Name**: `person_name`, `personName`, `PersonName`, `name`, `Name`, `UserName`, `employee_name`, `EmployeeName`.
- **Similarity / Confidence**: `similarity`, `Similarity`, `score`, `Score`, `confidence`, `confidence_score`, `Confidence`, `FaceScore`.

### 5.3. Tolerant Date Parsing
Thiết bị có thể gửi nhiều dạng Time (ISO string, Local, UNIX timestamp s/ms, hoặc Invalid).
- Ưu tiên bóc tách từ các trường: `event_time`, `capture_time`, `verify_time`, `timestamp` (bao gồm các dạng CamelCase/PascalCase).
- Nếu parse thất bại hoặc thiếu:
    - Fallback 1: Dùng cột `iot_device_events.event_time`.
    - Fallback 2: Dùng `payload_json.request_meta.received_at`.
- Không ném (throw) lỗi nếu payload timestamp sai cú pháp. 

### 5.4. Recognition Result
- Dựa trên `event_type = 'face_verify'` -> Mặc định `recognition_result = 'recognized'` (có thể set `rejected` nếu payload báo fail cụ thể, nhưng MVP không bắt buộc block).
- Dựa trên `event_type = 'face_stranger'` -> Mặc định `recognition_result = 'stranger'` (Person Info lúc này có thể là `null`).

### 5.5. Cấu trúc JSON Chuẩn `normalized_event`
```json
{
  "normalized_event_version": 1,
  "source": "face_server",
  "raw_event_id": "uuid",
  "event_type": "face_verify",
  "recognition_result": "recognized",
  "device": {
    "device_id": "uuid",
    "device_code": "TEST-CAM-001",
    "device_type": "door_face_terminal",
    "room_id": "uuid-or-null"
  },
  "person": {
    "device_person_id": "123",
    "device_person_code": "EMP001",
    "device_person_name": "Nguyen Van A"
  },
  "event_time": "2026-06-03T10:15:20.000Z",
  "received_at": "2026-06-03T10:15:22.000Z",
  "recognition": {
    "similarity": 92.5,
    "confidence_score": 92.5,
    "threshold": null
  },
  "media": {
    "has_image": false,
    "file_count": 0,
    "file_metadata": []
  },
  "normalization": {
    "status": "success",
    "normalized_at": "2026-06-03T10:15:23.000Z",
    "mapper_version": "face_server_v1"
  }
}
```

### 5.6. Data Protection & Security Rules
- Không ghi Plain Token / Password / Secret vào `normalized_event` hay `error_message`.
- Nếu có log lỗi ra hệ thống, không log toàn bộ Raw Payload để tránh rò rỉ dữ liệu nhạy cảm.
- Không lưu bất kỳ Binary / Base64 Image nào.
- Ghi chú: Việc liên tục Update cột `jsonb` có thể gây "Table Bloat" (phân mảnh DB). Sẽ có Technical Task về DB Cleanup/Archiving riêng cho các Event cũ ở tương lai, không xử lý trong MVP IOT-010.

### 5.7. Xử lý Batch Độc lập (Batch Processing Rule)
Với method `normalizePendingRawEvents(limit)`:
- Method này lấy tối đa `limit` raw events có:
  - `processed_status = 'received'`
  - `event_type IN ('face_verify', 'face_stranger')`
- Quá trình chuẩn hóa xử lý từng event độc lập.
- Nếu một event normalize lỗi (technical error / parse error):
  - Event đó được cập nhật `processed_status = 'failed'`.
  - Ghi `error_message` đã sanitize (không chứa token/secret).
  - Không làm dừng toàn bộ batch (không ném lỗi phá vỡ loop).
- Các event còn lại vẫn tiếp tục được xử lý bình thường.
- Kết quả method trả về dạng summary: `{ total, processed, ignored, failed }`.

### 5.8. Idempotency & Re-processing Rule
Với method `normalizeRawEvent(rawEventId)`:
- Mặc định chỉ normalize các record đang có `processed_status = 'received'`.
- Nếu record đã ở trạng thái `processed`, `ignored`, hoặc `failed`:
  - Không tự động normalize lại.
  - Method nên trả về kết quả dạng `skipped` (hoặc quăng Business Exception tuỳ convention), tuyệt đối không ghi đè vào `normalized_event`.
- Chưa hỗ trợ tuỳ chọn "Force Reprocess" trong phạm vi UC này.

## 6. Tiêu chí Nghiệm thu (Acceptance Criteria)
1. **AC1**: Service có thể quét 1 Event có `processed_status='received'`, bóc tách thông tin dựa theo Tolerant Alias và cập nhật thành `processed_status='processed'` với cục JSON `normalized_event` được lồng thành công.
2. **AC2**: Không sửa đổi hoặc phá vỡ các trường gốc (`raw_payload_sample`, `payload_hash`).
3. **AC3**: Quản lý tốt lỗi (Exception), nếu một event sai định dạng khủng khiếp làm crash hàm parse, event đó chuyển thành `failed` và ghi nhận `error_message` an toàn (không lộ secret), các event khác trong batch không bị ảnh hưởng.
4. **AC4**: Sự kiện `face_stranger` có thể normalize thành công dù không có đủ thông tin mã ID hay Tên người.
5. **AC5**: Không có REST API lộ ra ngoài liên quan tới UC này.
