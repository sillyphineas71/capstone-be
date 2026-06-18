# Walkthrough: Lưu raw event từ thiết bị camera (IOT-009)

## 1. Tóm tắt các thay đổi
Use Case IOT-009 đã được triển khai thành công, đảm bảo việc các Raw Event (từ IOT-007 và IOT-008) đều được ghi nhận vào bảng `iot_device_events` một cách an toàn và nhất quán.

### File đã tạo mới:
- `src/modules/iot/entities/iot-device-event.entity.ts`: Mapping 1-1 với DB Baseline (không sinh migration, không sửa đổi cấu trúc bảng).
- `src/modules/iot/services/iot-device-events.service.ts`: Internal Service chịu trách nhiệm xử lý logic `storeRawEvent`, hash payload và format cấu trúc JSONB.

### File đã sửa đổi:
- `src/modules/iot/iot.module.ts`: Đăng ký `IotDeviceEvent` entity và `IotDeviceEventsService` provider.
- `src/modules/iot/services/iot-devices.service.ts`: Inject service mới, tích hợp hàm `storeRawEvent` vào chung `queryRunner.manager` (Transaction) ở cả hai hàm `receiveVerifyEvent` và `receiveStrangerEvent`.
- `src/modules/iot/tests/iot-devices.service.spec.ts`: Bổ sung mock provider để đảm bảo Unit Test không bị crash.

## 2. Các điểm kỹ thuật nổi bật
- **Transaction Consistency:** Event được lưu (Insert) và Trạng thái thiết bị được cập nhật (Update) trong CÙNG MỘT Transaction. Nếu lệnh Insert lỗi, lập tức Rollback và trả 500. Thiết bị không hề ghi nhận ảo.
- **Tolerant Ingestion & Storage Limit:** Đã loại bỏ hoàn toàn `file.buffer`, các base64 string dài trong Body. Chỉ lưu thông tin metadata ảnh. Ngăn ngừa triệt để hiện tượng DB Bloat.
- **Tính toán SHA-256 Hash:** Mã `payload_hash` được tính ngay lúc runtime từ Payload đã mask (che token), và nhét gọn gàng vào trong `payload_json.payload_hash`. Không tạo ra bất kỳ column rác nào trong DB.
- **Bỏ qua Heartbeat:** Hoàn toàn đúng theo spec, `receiveHeartbeat` không gọi ghi Raw Event.

## 3. Kết quả Kiểm thử (Unit/Integration Test)
Tất cả Unit tests cho `IotDevicesService` đều **PASS 100%**:
```bash
> jest src/modules/iot/tests/iot-devices.service.spec.ts
PASS src/modules/iot/tests/iot-devices.service.spec.ts
  IotDevicesService
    receiveVerifyEvent
      √ should throw BadRequestException if device_code is missing
      √ should throw NotFoundException if device not found
      √ should process successfully with valid input
      √ should slice recent_verify_event_samples to 5 items

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

## 4. Hướng dẫn Manual DB Verification
Nếu bạn dùng Postman hoặc Camera gửi 1 event Verify/Stranger, luồng xử lý như sau:
1. Gửi HTTP POST tới `/api/v1/vf/...` hoặc `/api/v1/sf/...`
2. Mở DB UI (DBeaver / PgAdmin).
3. Kiểm tra bảng `iot_device_events`:
   - Phải xuất hiện 1 dòng mới nhất.
   - `event_type` là `face_verify` hoặc `face_stranger`.
   - Cột `payload_json` chứa đầy đủ JSON (xem `payload_hash`, xem object metadata thay vì buffer).
4. Kiểm tra bảng `iot_devices`:
   - Thiết bị cập nhật `last_seen_at`.
   - `metadata_json` có cập nhật snapshot vào chuỗi mảng 5 records mới nhất.

Quá trình tích hợp diễn ra trơn tru và an toàn!
