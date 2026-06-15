# Walkthrough: Nhận Stranger Event (IOT-008)

Quá trình triển khai tính năng nhận tín hiệu sự kiện Stranger Event từ thiết bị Face Server đã hoàn tất. Tính năng này đóng vai trò quan trọng trong việc thu thập nhật ký (telemetry) mỗi khi Camera nhận diện người lạ, lưu trữ giới hạn các file này nhằm mục đích phân tích cảnh báo an ninh sau này.

## File đã tạo / sửa đổi

1. **`src/modules/iot/controllers/stranger-short-device-callbacks.controller.ts`** [MỚI]
   - Controller dành riêng cho các thiết bị phần cứng gọi API bằng Alias ngắn nhằm vượt qua giới hạn độ dài URL (vd: `GET/POST /api/v1/sf/:deviceCode/:callbackToken`).
   - Có tích hợp `AnyFilesInterceptor` với giới hạn khắt khe (5MB, 5 Files) tại method `POST`.
   - Tránh việc đặt lẫn trong canonical API hay dùng chung với Heartbeat/Verify để code sạch sẽ và rõ ràng hơn.

2. **`src/modules/iot/controllers/device-callbacks.controller.ts`** [CẬP NHẬT]
   - Bổ sung 2 endpoint `GET/POST /api/v1/device-callbacks/face/stranger` cho chuẩn RESTful Canonical.
   - Cả Short và Canonical Controller đều gọi chung hàm Service, không có sự dư thừa logic.

3. **`src/modules/iot/iot.module.ts`** [CẬP NHẬT]
   - Thêm `StrangerShortDeviceCallbacksController` vào danh sách Controllers.

4. **`src/modules/iot/services/iot-devices.service.ts`** [CẬP NHẬT]
   - Định nghĩa `StrangerEventInput`.
   - Viết method lõi `receiveStrangerEvent(input)`. 
   - Kế thừa các Helper Method trích xuất mã thiết bị, mã xác thực (ưu tiên Path > Query > Body > Header).
   - Validation 7 bước tiêu chuẩn (Tồn tại thiết bị, Hỗ trợ Face Terminal, Face Server Config, Mã SHA-256 Token, Source IP hợp lệ).
   - Payload Tolerant Ingestion (bảo vệ khi Body trống, truncate khi quá dài 2000 ký tự, extract meta, xoá buffer của hình ảnh để tránh phình dung lượng DB).
   - Xây dựng mảng giới hạn vòng lưu (max 5 records) với `recent_stranger_event_samples`.

## Kết quả kiểm tra (Test & Build)
- Hệ thống đã tự động chạy lệnh `npm run lint` và `npm run build` thành công, không phát hiện lỗi vòng lặp logic hoặc cú pháp.
- Các Checkbox trong file `tasks.md` đã được update `[x]`.

## Hướng dẫn Manual Test

Để kiểm tra tín hiệu phần cứng trực tiếp từ Web UI của Camera, bạn hãy tiến hành:
1. Đăng nhập trang cấu hình phần cứng Face Server.
2. Tìm đến mục **Stranger Subscription**.
3. Điền giá trị cấu hình tương tự như sau:
   - **Stranger Subscription:** `Subscription Snap`
   - **Snap URL:** `/api/v1/sf/<DeviceCode_Của_Bạn>/<Token_Hiển_Thị_Trên_App>` (ví dụ `/api/v1/sf/TEST-CAM-001/aB3xD...`)
4. Xác nhận cấu hình IP và Port đã trỏ đúng về hệ thống backend.
5. Để hệ thống nhận, sau đó cho người lạ chưa đăng ký đi qua ống kính camera để kiểm tra luồng tạo File Snap.
6. Quan sát log trên server Backend hoặc kiểm tra trực tiếp Database (cột `metadata_json` ở bảng `iot_devices`). Sẽ có thêm object `last_stranger_event_sample` và 1 phần tử mới nhất xuất hiện ở vị trí số `0` của `recent_stranger_event_samples`.
