# Implementation Plan: Chuẩn hóa payload sự kiện camera (IOT-010)

## 1. Service structure
- Cập nhật internal service trong module `iot`: Sẽ thêm các method logic vào `IotDeviceEventsService` (đã được tạo ở IOT-009) để giữ convention gộp chung các method xử lý sự kiện thô, thay vì tạo mới `IotDeviceEventNormalizerService`.
- **Không tạo controller/API** nào liên quan đến service này.
- Các method chính sẽ thêm vào `IotDeviceEventsService`:
  - `normalizeRawEvent(rawEventId: string): Promise<IotDeviceEvent | { status: string, reason?: string }>`
  - `normalizePendingRawEvents(limit: number): Promise<any>` (mặc định lấy tối đa số limit record truyền vào).

## 2. Repository / Entity usage
- Tái sử dụng entity `IotDeviceEvent` và repository `Repository<IotDeviceEvent>` hiện có từ IOT-009.
- Không tạo migration và không thay đổi schema database.
- Sử dụng TypeORM để query các bản ghi từ bảng `iot_device_events`.

## 3. normalizeRawEvent(rawEventId)
Flow xử lý chi tiết:
1. **Tìm raw event**: Query event theo `rawEventId`.
2. **Kiểm tra tồn tại**: Nếu không tồn tại, quăng `NotFoundException`.
3. **Kiểm tra Idempotency**: Kiểm tra `processed_status`. Nếu đã là `processed`, `ignored`, hoặc `failed`, trả kết quả `{ status: 'skipped', reason: 'Already processed or invalid status' }`, không normalize lại và không ghi đè dữ liệu.
4. **Kiểm tra event_type**: Nếu `event_type` không thuộc `face_verify` hoặc `face_stranger`:
   - Update: `processed_status = 'ignored'` và `error_message = 'Unsupported event type for normalization'`.
   - Lưu và trả về kết quả.
5. **Trích xuất & Chuẩn hóa**: Nếu event hợp lệ, gọi helper method bóc tách dữ liệu để build `normalized_event`.
6. **Merge dữ liệu**: Gán kết quả vào `payload_json.normalized_event` (bảo toàn các field khác của `payload_json`).
7. **Cập nhật DB**: 
   - Set `processed_status = 'processed'`.
   - Set `error_message = null`.
   - Lưu (save) lại entity vào DB.

## 4. normalizePendingRawEvents(limit)
Flow xử lý chi tiết:
- Query lấy tối đa `limit` event có `processed_status = 'received'` và `event_type IN ('face_verify', 'face_stranger')`, order theo `created_at ASC`.
- Dùng vòng lặp `for...of` để xử lý từng event độc lập bằng cách gọi `this.normalizeRawEvent(event.id)`.
- Bọc khối gọi này trong `try...catch`. Nếu một event thất bại do lỗi không bắt được bên trong `normalizeRawEvent` (lỗi kĩ thuật/parse):
  - Catch lỗi, update event đó thành `processed_status = 'failed'` và ghi `error_message` đã sanitize (không chứa token/secret).
  - Lưu (save) riêng event lỗi này.
  - Vòng lặp vẫn tiếp tục với các event tiếp theo (không dừng cả batch).
- Cập nhật biến đếm count.
- Method trả về summary object:
  ```json
  {
    "total": 50,
    "processed": 48,
    "ignored": 1,
    "failed": 1,
    "skipped": 0
  }
  ```

## 5. Không sửa raw snapshot gốc
- Quá trình chuẩn hóa chỉ thực hiện merge (hoặc gán thêm key) vào object JSONB: `payload_json.normalized_event = builtNormalizedEvent;`.
- **Tuyệt đối không sửa hoặc xoá** các trường sau trong `payload_json`:
  - `raw_payload_sample`
  - `file_metadata`
  - `request_meta`
  - `device_snapshot`
  - `payload_hash`

## 6. Normalized event structure
Cấu trúc đích phải tuân thủ chuẩn sau:
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
**Quy tắc face_stranger**: 
- `recognition_result = 'stranger'`
- `person.device_person_id = null`
- `person.device_person_code = null`
- `person.device_person_name = null`

## 7. Field extraction helper
Xây dựng helper method nội bộ `extractField(payload, possibleKeys)` để tìm field một cách an toàn (tolerant):
- Quét qua danh sách các alias ưu tiên.
- Hỗ trợ flat object và nested object (có thể check chuỗi truy cập có dấu '.' nếu cần, hoặc quét mảng đệ quy đơn giản, hoặc dùng Lodash `get`).
- Không throw lỗi nếu thiếu trường, trả về `null`.
- Danh sách alias cần support:
  - **Person ID**: `person_id`, `personId`, `PersonID`, `UserID`, `user_id`, `EmployeeID`, `employee_id`, `card_no`, `CardNo`, `id`
  - **Person Name**: `person_name`, `personName`, `PersonName`, `name`, `Name`, `UserName`, `employee_name`, `EmployeeName`
  - **Similarity / confidence**: `similarity`, `Similarity`, `score`, `Score`, `confidence`, `confidence_score`, `Confidence`, `FaceScore`
  - **Event time**: `event_time`, `eventTime`, `EventTime`, `capture_time`, `captureTime`, `CaptureTime`, `verify_time`, `verifyTime`, `VerifyTime`, `timestamp`, `Timestamp`, `time`, `Time`

## 8. Date parsing
Tolerant date parsing:
- Support ISO string, local datetime string, Unix timestamp (dạng giây s hoặc mili-giây ms).
- Helper nội bộ `parseTolerantDate(payloadVal, dbEventTime, requestReceivedAt)`:
  - Cố gắng parse timestamp từ payload.
  - Nếu payload timestamp invalid/thiếu: dùng `dbEventTime` (từ `iot_device_events.event_time`).
  - Nếu vẫn invalid/thiếu: dùng `requestReceivedAt` (từ `payload_json.request_meta.received_at`).
  - Không ném exception do invalid date payload.

## 9. Recognition result rules
- Với `face_verify`: Mặc định `recognition_result = 'recognized'`. (Trong MVP này, tạm bỏ qua việc quét flag `fail` cụ thể từ payload).
- Với `face_stranger`: Mặc định `recognition_result = 'stranger'`.

## 10. Media info
Tạo media object từ mảng file metadata đã có trong `payload_json.file_metadata`:
- `has_image = file_metadata && file_metadata.length > 0`
- `file_count = file_metadata.length`
- `file_metadata = payload_json.file_metadata`
- **Không xử lý/lưu binary/base64**.

## 11. Security
- Trước khi ghi `error_message`, gọi hàm sanitize chuỗi lỗi để không rò rỉ token, password hay dữ liệu từ thẻ tín dụng (nếu có).
- Không thêm bất cứ Plain token/password/secret nào vào cục `normalized_event`.
- Trong console logger nội bộ, không log (print) toàn bộ biến `raw_payload_sample` ra ngoài terminal.
- Không lưu, không chứa binary/base64 image.

## 12. Processing status
Các trạng thái đầu ra (End states):
- **Normalize success**: `processed_status = 'processed'` và `error_message = null`.
- **Unsupported event**: `processed_status = 'ignored'` và `error_message = 'Unsupported event type for normalization'`.
- **Technical error**: `processed_status = 'failed'` và `error_message` chứa thông tin tóm tắt báo lỗi (đã sanitize).
- **Already processed/ignored/failed**: Không cập nhật lại DB, return object `{ status: 'skipped', reason: '...' }`.

## 13. Test strategy
Chiến lược Unit & Integration Test sẽ được bổ sung vào file `iot-device-events.service.spec.ts`:
1. **Thành công (face_verify)**: Kiểm tra event `face_verify` hợp lệ tạo ra chuẩn cấu trúc, `processed_status` thành `processed`. Các trường raw nguyên vẹn.
2. **Thành công (face_stranger)**: Kiểm tra `face_stranger` thiếu person id/name vẫn qua bước parse, `recognition_result = stranger`.
3. **Immutability (Độ toàn vẹn)**: Đảm bảo `payload_hash`, `raw_payload_sample` không bị thay đổi / mất đi sau khi save.
4. **Tolerant Extraction**: Test với các payload mock chứa các field phức tạp (VD: `CardNo`, nested `data.PersonID`) để xem helper chạy đúng ưu tiên alias không.
5. **Date Fallback**: Cố tình truyền payload timestamp bị lỗi dạng chuỗi rác (`abc`), test xem logic có fallback về `event_time` an toàn không.
6. **Bỏ qua Event Lạ**: Cố tình cấp `event_type = 'some_event'`, kết quả cập nhật status về `ignored`.
7. **Lỗi Kỹ Thuật (Fail-safe)**: Cố ý làm cho hàm parse lỗi (ví dụ throw Error bên trong), record phải bị update thành `failed` và error_message đã che (sanitized).
8. **Batch Độc Lập (`normalizePendingRawEvents`)**: Đưa 3 event (1 valid, 1 unsupported, 1 lỗi) vào, kết quả trả về đúng summary (đủ total, processed, ignored, failed) và không bị gãy vòng lặp giữa chừng.
9. **Idempotency**: Gọi `normalizeRawEvent` lên một event đã `processed`, trả về kết quả `skipped` và không sửa DB.
10. **Bảo mật / API**: Không test REST API (vì không tồn tại Controller Endpoint nào).
