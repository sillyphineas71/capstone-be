# Walkthrough: Chuẩn hóa payload sự kiện camera (IOT-010)

## 1. Tổng quan các thay đổi
Tính năng **Chuẩn hóa payload sự kiện camera (IOT-010)** đã được triển khai thành công, cung cấp một "Anti-Corruption Layer" giúp bóc tách và thống nhất các trường dữ liệu lộn xộn từ các thiết bị camera thành một JSON chuẩn hóa.

### File đã chỉnh sửa
- `src/modules/iot/services/iot-device-events.service.ts`

### File tạo mới
- `src/modules/iot/tests/iot-device-events.service.spec.ts`

---

## 2. Các Method đã thêm

### Trong `IotDeviceEventsService`
- **`normalizeRawEvent(rawEventId: string)`**:
  Thực hiện logic chính để xử lý 1 sự kiện. Kiểm tra tính hợp lệ (`received` status), loại bỏ sự kiện không được hỗ trợ (cập nhật thành `ignored`), xây dựng chuỗi JSON chuẩn và cập nhật trực tiếp vào field `payload_json.normalized_event`.
  Nếu có lỗi trong quá trình thực thi, error message sẽ được sanitize (che giấu mật khẩu, token) và cập nhật status thành `failed`.

- **`normalizePendingRawEvents(limit: number)`**:
  Hỗ trợ xử lý Batch (chạy hàng loạt) cho tối đa `limit` số event đang ở trạng thái `received`. Việc tính toán được bọc trong block Try/Catch độc lập để đảm bảo nếu một event bị gãy do ngoại lệ, toàn bộ batch không bị sụp đổ.

---

## 3. Các Helper đã thêm

- **`buildNormalizedEvent(rawEvent: IotDeviceEvent)`**: 
  Trích xuất các thông tin phân tán trong raw object, tạo ra cấu trúc chung theo chuẩn thiết kế MVP (`source`, `device`, `person`, `recognition`, `media`).
  
- **`extractField(payload: any, possibleKeys: string[])`**:
  Helper bóc tách trường thông tin Tolerant (chịu lỗi alias). Hỗ trợ cả object dạng phẳng (Flat) và dạng lồng ghép (Nested, ví dụ `data.personId`).
  
- **`parseTolerantDate(payloadVal, dbEventTime, requestReceivedAt)`**:
  Helper phân tích thời gian theo nhiều định dạng (ISO, mili-giây, giây). Cung cấp fallback an toàn về `event_time` hoặc `received_at` của request nếu như phần mềm camera gửi chuỗi ngày giờ sai logic.

---

## 4. Kết quả Unit Tests
Bộ Unit Test gồm **14/14 test cases PASSED** thành công:
1. Normalize `face_verify` thành công.
2. Normalize `face_stranger` thành công dù thiếu person id/name.
3. Chuyển đổi trạng thái `processedStatus` từ `received` sang `processed`.
4. Merge thành công `payloadJson.normalized_event`.
5. Đảm bảo toàn vẹn dữ liệu: **không sửa** snapshot gốc (`raw_payload_sample`, `payload_hash`).
6. Alias extraction tìm đúng key phẳng (`PersonID`).
7. Alias extraction tìm đúng key lồng nhau (`data.person_id`).
8. Date parsing hỗ trợ chuỗi ISO.
9. Date parsing hỗ trợ Unix Timestamp.
10. Fallback an toàn khi timestamp rác (`invalid-date`).
11. Bỏ qua (`ignored`) event loại không hỗ trợ (`heartbeat`).
12. Fail-safe: Quản lý lỗi kỹ thuật (chuyển sang `failed`) và che giấu secret (sanitized error message).
13. Xử lý Batch độc lập: Event lỗi không gây dừng hệ thống.
14. Idempotency: Không chạy lại các event đã xử lý (`processed`/`ignored`/`failed`).

---

## 5. Kết luận
Tất cả các AC (Acceptance Criteria) và Constraint đã được tuân thủ 100%. Quá trình xử lý diễn ra hoàn toàn ẩn, không tác động vào luồng API thời gian thực của IOT-007/008 và chưa có liên kết với dữ liệu người dùng (dành lại cho UC-011).
Cấu trúc chuẩn hóa `payload_json.normalized_event` đã sẵn sàng để các chức năng khác (như điểm danh) bắt đầu tiêu thụ.
